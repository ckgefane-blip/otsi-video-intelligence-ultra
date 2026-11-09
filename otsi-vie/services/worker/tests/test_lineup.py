"""Lineup cards (vie_worker.lineup, ADR-039) from text lines: rows of "number name" in two columns, the substitutes and coach headings in
other languages, a number the detector missed read from the left of its name, and frames that are not cards. Synthetic lines: no model."""
import os

from vie_worker.lineup import Line, parse_card


def L(text: str, x: int, y: int, w: int = 160, h: int = 20, conf: float = 0.99) -> Line:
    return Line(text, conf, x, y, x + w, y + h)


def english_card():
    lines = [L("RIVER ATHLETIC FC", 300, 40, w=400, h=40), L("SUBSTITUTES", 700, 110)]
    starters = [("1", "SMITH JOHN"), ("4", "GARCIA LUIS"), ("5", "O'NEILL SEAN"), ("6", "MÜLLER JONAS"), ("8", "DUBOIS ÉTIENNE"),
                ("10", "SILVA RAFAEL"), ("11", "KOWALSKI PIOTR"), ("14", "NAKAMURA KEN"), ("17", "OKAFOR CHIDI"), ("19", "ROSSI LUCA"),
                ("23", "BROWN TOM")]
    for i, (n, name) in enumerate(starters):
        y = 150 + 30 * i
        if n != "1":                                     # the detector missed the thin "1": only the name line is there
            lines.append(L(n, 300, y, w=24))
        lines.append(L(name, 340, y))
    for i, (n, name) in enumerate([("12", "HALL PETER"), ("15", "IBRAHIM SAID"), ("20", "LOPEZ DIEGO")]):
        y = 150 + 30 * i
        lines += [L(n, 700, y, w=24), L(name, 740, y)]
    lines += [L("Head coach", 700, 300), L("MARTIN PAUL", 700, 330)]
    return lines


def test_an_english_card_with_two_columns_headings_and_a_missed_number():
    card = parse_card(english_card(), digits=lambda ln: "1" if ln.text == "SMITH JOHN" else None)
    assert card is not None
    assert card.team == "RIVER ATHLETIC FC" and card.coach == "MARTIN PAUL"
    by = {e.number: (e.name, e.role) for e in card.entries}
    assert by["1"] == ("SMITH JOHN", "STARTER") and by["8"] == ("DUBOIS ÉTIENNE", "STARTER") and by["23"] == ("BROWN TOM", "STARTER")
    assert by["12"] == ("HALL PETER", "SUBSTITUTE") and by["20"] == ("LOPEZ DIEGO", "SUBSTITUTE")
    assert sum(e.role == "STARTER" for e in card.entries) == 11 and sum(e.role == "SUBSTITUTE" for e in card.entries) == 3


def test_without_the_number_reader_the_missed_number_stays_missing():
    card = parse_card(english_card())
    assert "1" not in {e.number for e in card.entries} and len(card.entries) == 13      # never guessed


def test_a_spanish_heading_and_a_frame_that_is_not_a_card():
    lines = [L("SUPLENTES", 700, 110)] + [x for i in range(10) for x in (L(str(i + 2), 300, 150 + 30 * i, w=24), L(f"JUGADOR {chr(65 + i)}", 340, 150 + 30 * i))]
    lines += [L("12", 700, 150, w=24), L("PORTERO Z", 740, 150), L("Entrenador: PÉREZ ANA", 700, 330, w=260)]
    card = parse_card(lines)
    assert card.coach == "PÉREZ ANA" and [e.role for e in card.entries if e.number == "12"] == ["SUBSTITUTE"]
    assert parse_card([L("2 - 1", 300, 40), L("45:12", 500, 40), L("GOAL", 300, 300)]) is None


def _card_video(path, font_path):
    """6 s of 1280x720 video: 2 s of plain grass, 4 s of an English team sheet (rendered text), mpeg4 via the LGPL FFmpeg."""
    import subprocess
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont
    from vie_worker import ff
    grass = np.zeros((720, 1280, 3), np.uint8); grass[...] = (40, 110, 50)
    img = Image.new("RGB", (1280, 720), (20, 40, 110)); d = ImageDraw.Draw(img)
    big, f = ImageFont.truetype(font_path, 40), ImageFont.truetype(font_path, 24)
    d.text((420, 40), "RIVER ATHLETIC FC", font=big, fill="white")
    d.text((760, 120), "SUBSTITUTES", font=f, fill="white")
    starters = ["SMITH JOHN", "GARCIA LUIS", "ONEILL SEAN", "MULLER JONAS", "DUBOIS PAUL", "SILVA RAFAEL", "KOWALSKI PIOTR", "NAKAMURA KEN",
                "OKAFOR CHIDI", "ROSSI LUCA", "BROWN TOM"]
    for i, n in enumerate(starters):
        d.text((300, 170 + 40 * i), f"{i + 2:>2}", font=f, fill="white"); d.text((350, 170 + 40 * i), n, font=f, fill="white")
    for i, n in enumerate(["HALL PETER", "IBRAHIM SAID", "LOPEZ DIEGO"]):
        d.text((760, 170 + 40 * i), str(20 + i), font=f, fill="white"); d.text((810, 170 + 40 * i), n, font=f, fill="white")
    d.text((760, 420), "HEAD COACH", font=f, fill="white"); d.text((760, 460), "MARTIN PAUL", font=f, fill="white")
    card = np.asarray(img)
    p = subprocess.Popen([ff.tool("ffmpeg"), "-hide_banner", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "1280x720", "-framerate", "25",
                          "-i", "pipe:0", "-vf", "format=yuv420p", "-c:v", "mpeg4", "-q:v", "2", str(path)], stdin=subprocess.PIPE)
    for k in range(150):
        p.stdin.write((grass if k < 50 else card).tobytes())
    p.stdin.close(); assert p.wait() == 0


def test_read_lineups_job_finds_and_reads_a_card_end_to_end(stack, root, seed, tmp_path):
    import json, uuid
    from pathlib import Path
    import pytest
    from vie_worker.detect.base import models_dir
    from vie_worker.jobs import JobRunner
    from vie_worker.main import HANDLERS
    font = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "arialbd.ttf"
    if not font.exists() or not (models_dir() / "ppocr_v5_latin_rec" / "inference.pdiparams").exists():
        pytest.skip("needs a TrueType font and the registered OCR models (tools/models/fetch_url_models.py)")
    org, user, project = seed.org()
    video, asset, rid = (str(uuid.uuid4()) for _ in range(3))
    key = f"org/{org}/videos/{video}/source.mp4"
    dest = stack["storage"].joinpath(*key.split("/")); dest.parent.mkdir(parents=True, exist_ok=True)
    _card_video(dest, str(font))
    with root.cursor() as cur:
        cur.execute("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (%s, %s, %s, 'SOURCE', %s, 'local', 1)", (asset, org, project, key))
        cur.execute("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, duration_us, width, height, created_by, source_asset_id) "
                    "VALUES (%s, %s, %s, 'UPLOAD', 'INGESTED', 6000000, 1280, 720, %s, %s)", (video, org, project, user, asset))
        cur.execute("INSERT INTO lineup_reads (id, organization_id, video_id) VALUES (%s, %s, %s)", (rid, org, video))
        cur.execute("INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload) VALUES (UUID(), %s, 'READ_LINEUPS', 'lineup_read', %s, %s, %s)",
                    (org, rid, f"read_lineups:{rid}", json.dumps({"lineup_read_id": rid})))
    assert JobRunner(stack["dsn"], "test-worker", ["READ_LINEUPS"], lease_seconds=120).run_one(HANDLERS) == "succeeded"
    with root.cursor() as cur:
        cur.execute("SELECT status, metrics FROM lineup_reads WHERE id = %s", (rid,)); r = cur.fetchone()
        cur.execute("SELECT team_name, coach_name, entries, frame_asset_id FROM lineup_cards WHERE read_id = %s", (rid,)); cards = cur.fetchall()
    assert r["status"] == "SUCCEEDED" and len(cards) == 1, (r, cards)
    c = cards[0]
    entries = {e["number"]: (e["name"], e["role"]) for e in json.loads(c["entries"])}
    assert c["team_name"] == "RIVER ATHLETIC FC" and c["coach_name"] == "MARTIN PAUL" and c["frame_asset_id"]
    assert entries["2"] == ("SMITH JOHN", "STARTER") and entries["12"] == ("BROWN TOM", "STARTER") and entries["21"] == ("IBRAHIM SAID", "SUBSTITUTE")
    assert len(entries) == 14
