"""Appearance rules (ADR-031) on synthetic inputs, isolated from any database (ADR-020)."""
import numpy as np

from vie_worker import appearance as ap


def hist(hue_bin: int, noise: float = 0.0, seed: int = 0) -> np.ndarray:
    h = np.zeros(24, np.float32)
    h[hue_bin] = 1.0
    h += np.random.default_rng(seed).random(24).astype(np.float32) * noise
    return h / h.sum()


def test_two_kits_form_two_groups_and_an_odd_colour_gets_none():
    hists = {i: hist(2, 0.05, i) for i in range(6)}                    # red kits
    hists.update({10 + i: hist(10, 0.05, i) for i in range(6)})         # blue kits
    hists[99] = hist(20, 0.0)                                           # a referee in black
    g = ap.kit_groups(hists)
    assert len({g[i] for i in range(6)}) == 1 and len({g[10 + i] for i in range(6)}) == 1
    assert g[0] != g[10] and g[99] is None


def test_links_are_mutual_best_matches_never_overlapping_and_one_per_direction():
    e = lambda v: np.array(v, np.float32) / np.linalg.norm(v)
    mk = lambda n, t0, t1, emb, shot=0: ap.TrackAppearance(n, shot, t0, t1, 6, hist(2), np.zeros(3), e(emb), 0.9, group=0)
    a = mk(1, 0, 1_000_000, [1, 0, 0])
    b = mk(2, 3_000_000, 4_000_000, [0.98, 0.2, 0], shot=1)             # same person after a cut
    c = mk(3, 3_500_000, 5_000_000, [0.7, 0.7, 0])                      # someone else, also later
    d = mk(4, 500_000, 2_000_000, [1, 0, 0])                            # overlaps a in time: never linked to a
    links = ap.propose_links([a, b, c, d])
    pairs = {(x["a"], x["b"]) for x in links}
    assert (1, 4) not in pairs and (1, 2) in pairs and (1, 3) not in pairs
    assert next(x for x in links if (x["a"], x["b"]) == (1, 2))["crosses_cut"] is True
    for n in (1, 2, 3, 4):                                              # at most one suggestion per direction per track
        assert sum(1 for x in links if x["a"] == n) <= 1 and sum(1 for x in links if x["b"] == n) <= 1


def test_the_crop_reservoir_keeps_evenly_spread_crops_and_the_largest_box():
    r = ap.CropReservoir()
    rgb = np.zeros((400, 600, 3), np.uint8)
    for i in range(100):
        r.offer(i * 100_000, rgb, (0.1, 0.1, 0.05 + 0.001 * i, 0.2))
    assert len(r.crops) <= ap.MAX_CROPS and r.stride > 1
    ts = [t for t, _ in r.crops]
    assert ts == sorted(ts) and ts[-1] - ts[0] >= 5_000_000             # spread over the track, not the first frames only
    assert r.largest[1].shape[1] >= int((0.05 + 0.099) * 600)           # the widest box was kept for the thumbnail


def shirt(rgb, h=120, w=60):
    """A crop: green grass behind, a shirt of one colour in the middle of the torso."""
    im = np.zeros((h, w, 3), np.uint8)
    im[:] = (70, 110, 50)
    im[int(0.18 * h):int(0.55 * h), int(0.2 * w):int(0.8 * w)] = rgb
    return im


def test_the_shirt_colour_is_read_from_the_torso_without_grass_or_skin():
    white, black, lime = ap.jersey_lab(shirt((235, 235, 230))), ap.jersey_lab(shirt((25, 25, 35))), ap.jersey_lab(shirt((200, 235, 40)))
    assert white[0] > 80 and black[0] < 25 and lime[2] > 50                     # lightness and the yellow axis
    assert ap.jersey_lab(np.zeros((10, 4, 3), np.uint8)) is None                # too small to read: unknown, not guessed


def test_two_team_colours_and_the_officials_are_told_apart_whatever_the_kits_are():
    rng = np.random.default_rng(1)
    j = {}
    for i in range(30):
        j[i] = ap.jersey_lab(shirt(np.clip((235, 235, 230) + rng.normal(0, 8, 3), 0, 255)))          # light kit
        j[100 + i] = ap.jersey_lab(shirt(np.clip((25, 25, 35) + rng.normal(0, 8, 3), 0, 255)))        # dark kit
    for i in range(4):
        j[200 + i] = ap.jersey_lab(shirt((200, 235, 40)))                                              # referee and linesmen
    j[300] = ap.jersey_lab(shirt((200, 30, 40)))                                                       # a third kit (other footage): not forced into a team
    g = ap.team_groups(j)
    assert {g[i] for i in range(30)} == {0} and {g[100 + i] for i in range(30)} == {1}                  # one colour per team, 0 = the lighter
    assert {g[200 + i] for i in range(4)} == {2}
    assert g[300] is None
    # any other pair of kits works the same way: a red team against a blue team, nothing about white or black is built in
    k = {i: ap.jersey_lab(shirt((200, 30, 40))) for i in range(20)} | {50 + i: ap.jersey_lab(shirt((30, 50, 190))) for i in range(20)}
    h = ap.team_groups(k)
    assert len({h[i] for i in range(20)}) == 1 and len({h[50 + i] for i in range(20)}) == 1 and h[0] != h[50]


def test_a_track_is_cut_where_its_shirt_colour_changes_and_an_odd_crop_does_not_cut_it():
    from vie_worker.analyze import drop_double_boxes
    from vie_worker.tracker import Observation, Track
    white, dark = shirt((235, 235, 235)), shirt((25, 25, 30))

    def make(colours):
        obs = [Observation(i, i * 100_000, 0.1, 0.1, 0.05, 0.2, 0.9, 1.0) for i in range(len(colours) * 2)]
        t = Track(number=1, label="PERSON", shot_number=0, observations=obs, hits=len(obs), last_pts_us=obs[-1].pts_us)
        res = ap.CropReservoir(crops=[(i * 200_000, c) for i, c in enumerate(colours)])
        return t, {id(t): res}

    t, res = make([white] * 4 + [dark] * 4)                       # a swap: one number, two people
    nums = iter(range(100, 200))
    out = ap.split_on_shirt_change([t], res, lambda: next(nums))
    assert len(out) == 2 and out[0].number == 1 and out[1].number == 100
    assert len(out[0].observations) + len(out[1].observations) == 16 and out[0].observations[-1].pts_us < out[1].observations[0].pts_us
    assert out[0].observations[-1].pts_us < 700_000 <= out[1].observations[0].pts_us          # cut midway between the last white and the first dark crop
    t2, res2 = make([white] * 3 + [dark] + [white] * 3)           # one dark crop (a passer-by in front) is not a different person
    assert len(ap.split_on_shirt_change([t2], res2, lambda: 7)) == 1

    a = Track(number=1, label="PERSON", shot_number=0, observations=[Observation(1, 0, 0.1, 0.1, 0.05, 0.2, 0.9, 1.0), Observation(2, 1, 0.1, 0.1, 0.05, 0.2, 0.9, 1.0)])
    b = Track(number=2, label="PERSON", shot_number=0, observations=[Observation(1, 0, 0.101, 0.1, 0.05, 0.2, 0.6, 1.0)])
    assert drop_double_boxes([a, b]) == 1 and len(a.observations) == 2 and b.observations == []   # one person, one box: the longer track keeps it


def test_a_track_is_cut_twice_when_its_shirt_changes_and_returns_to_the_first_colour():
    # U.3: a track swapped twice (white -> dark -> white) is three people under one number, not one.
    # Deliberately imports only tracker, not analyze: analyze needs pyarrow, which this workspace lacks.
    from vie_worker.tracker import Observation, Track
    white, dark = shirt((235, 235, 235)), shirt((25, 25, 30))

    def make(colours):
        obs = [Observation(i, i * 100_000, 0.1, 0.1, 0.05, 0.2, 0.9, 1.0) for i in range(len(colours) * 2)]
        t = Track(number=1, label="PERSON", shot_number=0, observations=obs, hits=len(obs), last_pts_us=obs[-1].pts_us)
        res = ap.CropReservoir(crops=[(i * 200_000, c) for i, c in enumerate(colours)])
        return t, {id(t): res}

    t, res = make([white] * 4 + [dark] * 4 + [white] * 4)
    nums = iter(range(100, 200))
    out = ap.split_on_shirt_change([t], res, lambda: next(nums))
    assert len(out) == 3 and [o.number for o in out] == [1, 100, 101]
    assert [len(o.observations) for o in out] == [7, 8, 9] and sum(len(o.observations) for o in out) == 24
    assert out[0].observations[-1].pts_us < 700_000 <= out[1].observations[0].pts_us
    assert out[1].observations[-1].pts_us < 1_500_000 <= out[2].observations[0].pts_us

    t2, res2 = make([white] * 4 + [dark] * 2 + [white] * 4)       # a two-crop middle run is still a different person
    out2 = ap.split_on_shirt_change([t2], res2, lambda: 7)
    assert len(out2) == 3


def test_a_bright_lime_shirt_is_not_thrown_away_as_grass_so_the_referee_is_an_official():
    lime = np.full((120, 60, 3), (70, 110, 50), np.uint8)                  # a far referee: little shirt, much grass around it
    lime[int(0.18 * 120):int(0.55 * 120), int(0.42 * 60):int(0.58 * 60)] = (205, 232, 40)
    j = ap.jersey_lab(lime)
    chroma, hue = float(np.hypot(j[1], j[2])), float(np.degrees(np.arctan2(j[2], j[1])) % 360)
    assert chroma >= 30 and 72 <= hue <= 128 and j[0] >= 45                        # the shirt's own vivid lime is read, not dropped as grass


# ------------------------------------------------------------------ teams taught from the kickoff
def _people(rng, n, lab, cx, spread=0.08):
    return [(np.asarray(lab, float) + rng.normal(0, 3, 3), float(np.clip(cx + rng.normal(0, spread), 0, 1))) for _ in range(n)]


def test_the_kickoff_teaches_two_team_colours_when_the_teams_stand_on_separate_halves():
    rng = np.random.default_rng(1)
    black, white = [22, 0, 0], [78, 0, 2]
    people = _people(rng, 9, black, 0.25) + _people(rng, 10, white, 0.75) + _people(rng, 3, [88, -14, 70], 0.5, 0.2)   # referee and linesmen in lime
    ref, info = ap.build_team_reference(people)
    assert ref is not None and info["ok"] and info["players"] == [10, 9] and info["officials"] == 3
    assert ref.labs[0][0] > ref.labs[1][0]                                                                          # team 0 = the lighter shirt
    assert info["team0_side"] == "right"
    # every later detection is called against those two colours: clearly white, clearly black, a lime referee, an unclear grey, and a shirt too small to read
    assert ref.classify(np.array([74, 1, 1])) == 0 and ref.classify(np.array([30, 0, 1])) == 1
    assert ref.classify(np.array([88, -14, 70])) == 2
    assert ref.classify(np.array([50, 0, 0])) is None and ref.classify(None) is None
    # a lone referee cannot be learned as "the officials" (one person is just an odd shirt), but he is not forced into a team either
    alone, info = ap.build_team_reference(_people(rng, 9, black, 0.25) + _people(rng, 10, white, 0.75) + [(np.array([88.0, -14.0, 70.0]), 0.5)])
    assert alone is not None and alone.official is None and alone.classify(np.array([88, -14, 70])) is None


def test_the_kickoff_is_refused_with_a_reason_when_the_teams_cannot_be_told_apart_or_are_mixed():
    rng = np.random.default_rng(2)
    mixed = _people(rng, 9, [22, 0, 0], 0.5, 0.3) + _people(rng, 9, [78, 0, 2], 0.5, 0.3)                           # both teams all over the pitch: not a kickoff
    ref, info = ap.build_team_reference(mixed)
    assert ref is None and not info["ok"] and "separate halves" in info["reason"]
    alike = _people(rng, 9, [60, 0, 0], 0.25) + _people(rng, 9, [66, 1, 1], 0.75)
    assert ap.build_team_reference(alike)[0] is None
    assert ap.build_team_reference(_people(rng, 3, [22, 0, 0], 0.2) + _people(rng, 3, [78, 0, 0], 0.8))[0] is None  # too few readable players


def test_a_track_gets_its_team_from_the_majority_of_its_own_calls_and_unknown_when_unsure():
    assert ap.group_from_votes([1, 1, 1, 1, None, 0]) == 1
    assert ap.group_from_votes([1, 0, 1, 0, 1, 0]) is None                      # no clear majority
    assert ap.group_from_votes([1, 1, None, None]) is None                      # too few calls
    assert ap.group_from_votes([2, 2, 2, 1]) == 2                               # officials
    assert ap.group_from_votes([1] * 14 + [None] * 16) is None                  # 14 agreeing reads in 30 frames: unknown, not settled (a bent player read wrong)


def test_the_tracker_never_gives_a_box_of_one_team_to_a_track_of_the_other_even_when_players_cross():
    from vie_worker.detect.base import Detection
    from vie_worker.tracker import Tracker

    def det(x):
        return Detection(label="PERSON", score=0.9, x=x, y=0.5, w=0.03, h=0.1)

    def run(gate: bool) -> list[tuple[int, list[float]]]:
        tr = Tracker(min_hits=1, team_gate=gate, distance_weight=0.3)
        # a white player (team 0) runs right and a black player (team 1) runs left; they cross at the middle and, being side by side, a plain tracker may swap them
        for i in range(12):
            a, b = 0.30 + 0.025 * i, 0.60 - 0.025 * i
            ds = [det(a), det(b)]
            tr.update(i, i * 166_000, ds, teams={id(ds[0]): 0, id(ds[1]): 1})
        return [(Tracker.track_team(t), [o.x for o in t.observations]) for t in tr.results()]

    for team, xs in run(True):
        assert team in (0, 1)
        steps = np.diff(xs)
        assert (steps > 0).all() if team == 0 else (steps < 0).all()            # each team's track keeps its direction: no box ever changed team at the crossing


def test_the_officials_colour_seen_at_kickoff_makes_a_pale_referee_an_official_and_the_dark_near_player_a_team_member():
    rng = np.random.default_rng(3)
    black, white = [40, 0, 0], [70, 2, -8]
    people = _people(rng, 9, black, 0.25) + _people(rng, 10, white, 0.75) + [(np.array([79, -15, 32]), 0.5), (np.array([78, -14, 34]), 0.6)]   # two lime officials
    ref, info = ap.build_team_reference(people)
    assert ref is not None and info["official_colour_lab"] is not None
    assert ref.classify(np.array([78.8, -9.7, 20.7])) == 2        # the same referee in another frame, pale in the sun (chroma 23, below the plain lime rule)
    assert ref.classify(np.array([14, 2, -5])) == 1               # a near player in black, far darker than the small readings the colour was taught from
    assert ref.classify(np.array([55, 0, 0])) is None             # a grey between the two teams: not sure
    assert ref.classify(np.array([70, 2, -8])) == 0               # a white shirt is not an official however pale


def test_the_kickoff_finder_picks_the_moment_where_the_teams_stand_on_their_halves_and_says_so_when_there_is_none():
    rng = np.random.default_rng(4)
    black, white = [30, 0, 0], [72, 2, -8]
    studio = _people(rng, 2, black, 0.5)                                                                               # a studio shot: two faces
    huddle = _people(rng, 5, black, 0.4, 0.05) + _people(rng, 5, white, 0.45, 0.05)                                    # both teams in one place: not separate halves
    kickoff = _people(rng, 10, black, 0.25) + _people(rng, 10, white, 0.75) + [(np.array([79, -15, 32]), 0.5), (np.array([78, -14, 34]), 0.55)]
    later = _people(rng, 11, black, 0.45, 0.25) + _people(rng, 11, white, 0.55, 0.25)                                  # open play: mixed
    seen = {0: studio, 20: huddle, 40: kickoff, 60: later}
    asked: list[int] = []

    def people_of(t):
        asked.append(t)
        return seen.get(t)

    t, info = ap.find_kickoff([0, 20, 40, 60, 80], people_of)
    assert t == 40 and info["ok"] and info["official_colour_lab"] is not None
    assert asked == [0, 20, 40]                                                                                         # it stopped at the first clear formation
    none_t, why = ap.find_kickoff([0, 20, 60], lambda t: seen.get(t))
    assert none_t is None and "kickoff" in why["reason"] and why["auto"]
    assert ap.find_kickoff([], lambda t: None)[0] is None
    # staff or substitutes in two coats are never eleven: too few readable players in a team is not a kickoff
    bench = _people(rng, 4, black, 0.2) + _people(rng, 4, white, 0.8)
    assert ap.find_kickoff([0], lambda t: bench)[0] is None
    # the coin toss: both teams in their own groups, the officials overlapping in the middle (one readable): the search goes on to the kickoff,
    # where the officials' colour can be learned too, and does not stop at the toss
    toss = _people(rng, 9, black, 0.2) + _people(rng, 9, white, 0.8) + [(np.array([79, -15, 32]), 0.5)]
    asked.clear()
    t, info = ap.find_kickoff([0, 20, 40, 60], lambda t: (asked.append(t), {0: toss, 40: kickoff}.get(t))[1])
    assert t == 40 and info["official_colour_lab"] is not None and asked == [0, 20, 40]
    t, info = ap.find_kickoff([0, 20], lambda t: {0: toss}.get(t))                                                   # no better moment: the toss is still used
    assert t == 0 and info["official_colour_lab"] is None


def test_a_shirt_is_read_only_from_an_upright_player_big_enough_and_against_the_ground_beside_him():
    from vie_worker.detect.base import Detection
    rng = np.random.default_rng(7)
    frame = np.zeros((720, 1280, 3), np.uint8)
    frame[:] = (70, 100, 60)                                                         # the ground, sunlit
    frame[:, 640:] = (30, 42, 28)                                                    # the same ground in shadow, right half
    frame[300:380, 100:130] = (20, 20, 22)                                           # a black shirt in sun, upright: 30 px wide, 80 high
    frame[300:380, 100:130][:, 12:18] = (235, 235, 235)                              # with a white stripe through the middle
    frame[300:380, 700:730] = (95, 98, 105)                                          # a white shirt in shade: darker than the sunlit ground but brighter than the shaded ground
    frame += rng.integers(0, 4, frame.shape, dtype=np.uint8)

    def det(x, y, w, h):
        return Detection(label="PERSON", score=0.9, x=x / 1280, y=y / 720, w=w / 1280, h=h / 720)

    ref = ap.TeamReference(labs=np.array([[75.0, 1.0, -3.0], [35.0, 0.0, 1.0]]))
    assert ref.classify_detection(frame, det(100, 300, 30, 80)) == 1                 # black with a stripe: mostly black pixels
    assert ref.classify_detection(frame, det(700, 300, 30, 80)) == 0                 # white in shade: brighter than the shaded ground beside it
    assert ref.classify_detection(frame, det(100, 330, 70, 40)) is None              # bent over / lying (box wider than tall): not read
    assert ref.classify_detection(frame, det(100, 300, 10, 20)) is None              # too small to hold a shirt: not read


def test_a_washed_out_linesman_keeps_the_officials_hue_and_is_not_given_to_the_white_team(monkeypatch):
    """The owner's match, 24:55: taught at 23:20 the officials were a strong lime; the far linesman read pale lime and was called white (2026-10-31)."""
    rng = np.random.default_rng(11)
    ref = ap.TeamReference(labs=np.array([[78.0, 3.9, -12.7, 81.0], [29.7, 1.8, -6.4, 34.8]]), official=np.array([82.7, -21.5, 35.5, 83.4]))

    def shirt(lab):
        return np.asarray(lab, float)[None] + rng.normal(0, 2.0, (80, 4))

    for lab, want in [([69.2, -4.4, 16.3, 97.3], 2),                      # the pale far linesman: officials (colour distance 31 > 28, but the officials' hue)
                      ([61.8, -4.9, 19.6, 96.0], 2),
                      ([78.0, 3.9, -12.7, 81.0], 0),                      # a white shirt: still white
                      ([80.0, 2.0, 9.0, 84.0], 0),                        # a white shirt warmed by the sun (pale yellow, chroma 9): still white, not an official
                      ([44.5, -1.8, 5.1, 59.9], 1)]:                      # a black shirt: still black
        monkeypatch.setattr(ap, "detection_pixels", lambda rgb, d, boxes=None, p=shirt(lab): p)
        assert ref.classify_detection(None, None) == want, lab
    # a team in a kit of nearly the officials' hue: its players are not taken for officials, pale or vivid (no colour means "official" by itself)
    yellow_team = ap.TeamReference(labs=np.array([[80.0, -8.0, 40.0, 85.0], [30.0, 0.0, 0.0, 35.0]]), official=np.array([82.7, -21.5, 35.5, 83.4]))
    monkeypatch.setattr(ap, "detection_pixels", lambda rgb, d, boxes=None, p=shirt([70.0, -4.0, 22.0, 80.0]): p)
    assert yellow_team.classify_detection(None, None) != 2
    monkeypatch.setattr(ap, "detection_pixels", lambda rgb, d, boxes=None, p=shirt([80.0, -8.0, 40.0, 85.0]): p)
    assert yellow_team.classify_detection(None, None) == 0


def test_the_officials_are_learned_at_the_kickoff_whatever_they_wear():
    """Owner directive 2026-10-31: no jersey colour is assumed. The officials are the small group of one colour unlike both teams."""
    rng = np.random.default_rng(21)

    def kickoff(team_a, team_b, officials=None, keepers=()):
        p = _people(rng, 10, team_a, 0.25) + _people(rng, 10, team_b, 0.75)
        if officials is not None:
            p += _people(rng, 3, officials, 0.5, 0.2)                                                     # referee in the middle, linesmen on the lines
        for k in keepers:
            p += _people(rng, 1, k, 0.05 if len(p) % 2 else 0.95, 0.01)
        return p

    cases = [([75, 0, -3], [20, 0, 0], [80, -15, 33]),      # white v black, officials in lime
             ([75, 0, -3], [45, 5, -40], [20, 0, 0]),       # white v blue, officials in BLACK
             ([45, 55, 35], [40, 10, -45], [85, -5, 60]),   # red v blue, officials in yellow
             ([80, -8, 40], [20, 0, 0], [45, 55, 35])]      # a YELLOW team v black, officials in red
    for a, b, o in cases:
        ref, info = ap.build_team_reference(kickoff(a, b, o, keepers=([30, -40, 20], [50, 60, -10])))
        assert ref is not None and info["officials"] >= 2, (a, b, o, info)
        assert np.linalg.norm(ref.official - np.asarray(o, float)) < 8, (o, ref.official)
        assert ref.classify(np.asarray(o, float) + 2) == 2 and ref.classify(np.asarray(a, float)) in (0, 1) and ref.classify(np.asarray(b, float)) in (0, 1)
    # no officials in view: none are invented, and two goalkeepers in two different kits are not taken for officials
    ref, info = ap.build_team_reference(kickoff([75, 0, -3], [20, 0, 0], None, keepers=([30, -40, 20], [50, 60, -10])))
    assert ref is not None and ref.official is None and info["officials"] == 0


# ------------------------------------------------------------------ U.5: part-based Re-ID
GRASS_RGB = (70, 110, 50)


def person_crop(head, torso, shorts, socks, h=120, w=60, noise=0, seed=0):
    """One synthetic person crop: grass behind, head / torso / legs in the U.5 part bounds."""
    rng = np.random.default_rng(seed)
    im = np.zeros((h, w, 3), np.uint8)
    im[:] = GRASS_RGB
    im[0:int(0.15 * h), :] = head
    im[int(0.15 * h):int(0.55 * h), int(0.2 * w):int(0.8 * w)] = torso
    im[int(0.55 * h):int(0.78 * h), int(0.2 * w):int(0.8 * w)] = shorts
    im[int(0.78 * h):, int(0.2 * w):int(0.8 * w)] = socks
    if noise:
        im = np.clip(im.astype(int) + rng.integers(-noise, noise + 1, im.shape), 0, 255).astype(np.uint8)
    return im


WHITE_KIT = (235, 235, 230)
PLAYER_A = person_crop((60, 40, 25), WHITE_KIT, (20, 20, 25), (230, 230, 230))        # dark hair, white socks
PLAYER_A2 = person_crop((60, 40, 25), WHITE_KIT, (20, 20, 25), (230, 230, 230), noise=6, seed=1)  # same player, another crop
PLAYER_B = person_crop((210, 180, 90), WHITE_KIT, (20, 20, 25), (180, 40, 40))      # blond hair, red socks, same white kit


def test_whole_crop_cannot_tell_same_kit_players_apart():
    """U.5 failing case, with only the pre-U.5 signals: the whole-crop kit histogram is identical for the
    same player and for a different player in the same kit, and the torso Lab distance is 0.0."""
    a, b = ap.kit_histogram(PLAYER_A).astype(float), ap.kit_histogram(PLAYER_B).astype(float)
    assert float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b))) > 0.999
    assert float(np.linalg.norm(ap.jersey_lab(PLAYER_A) - ap.jersey_lab(PLAYER_B))) < 0.5


def test_part_crops_split_head_torso_legs_and_mask_grass():
    parts = ap.part_crops(PLAYER_A)
    assert set(parts) == {"head", "torso", "legs"} and all(v is not None for v in parts.values())
    assert parts["head"].shape[0] == 18 and parts["torso"].shape[0] == 48 and parts["legs"].shape[0] == 54
    # a crop that is all grass except the shirt: head and legs cannot be read, torso can
    im = np.zeros((120, 60, 3), np.uint8)
    im[:] = GRASS_RGB
    im[18:66, 12:48] = WHITE_KIT
    grassy = ap.part_crops(im)
    assert grassy["head"] is None and grassy["legs"] is None and grassy["torso"] is not None
    assert ap.part_crops(np.zeros((10, 4, 3), np.uint8)) == {"head": None, "torso": None, "legs": None}  # too small: unknown


def test_part_similarity_separates_same_kit_players():
    """The U.5 fix for the failing case: head + legs (down-weighted torso) tell A from B, same kit or not."""
    same = ap.part_similarity(ap.part_colour_vectors(PLAYER_A), ap.part_colour_vectors(PLAYER_A2))
    diff = ap.part_similarity(ap.part_colour_vectors(PLAYER_A), ap.part_colour_vectors(PLAYER_B))
    assert same > 0.85 and diff < 0.65 and same - diff > 0.3, (same, diff)   # measured: 0.982 vs 0.588
    _, detail = ap.part_similarity_detail(ap.part_colour_vectors(PLAYER_A), ap.part_colour_vectors(PLAYER_B))
    assert detail["torso"] > 0.99 and detail["head"] < 0.65      # the torso agrees (same kit); the head disagrees
    assert ap.part_similarity(None, ap.part_colour_vectors(PLAYER_B)) is None
    assert ap.part_similarity({"head": None}, {"legs": np.ones(15, np.float32)}) is None   # no part in common


def test_grass_pixels_do_not_move_a_part_vector():
    """Blueprint §5 acceptance, measured: grass pixels are excluded from the descriptor — recolouring the
    grass alone changes the part vector by nothing (cosine 1.0 to float precision) and leaves the masked crop
    identical, because only non-grass pixels are read. Speckling grass OVER the socks still keeps the vector close (0.915):
    the median moves a little because the pixel mix changes, but no grass pixel ever enters the descriptor."""
    clean = person_crop((60, 40, 25), WHITE_KIT, (20, 20, 25), (230, 230, 230))
    recol = clean.copy()
    legs = recol[66:120]
    recol[66:120][ap._grass_mask(legs)] = (40, 90, 40)      # same grass, a different green
    a = ap.part_colour_vectors(clean)["legs"]
    assert float(a @ ap.part_colour_vectors(recol)["legs"]) > 0.999999   # identical up to float32 rounding
    assert np.array_equal(ap.part_crops(clean)["legs"], ap.part_crops(recol)["legs"])
    grassy = clean.copy()
    grassy[93:120:2, ::2] = GRASS_RGB                       # speckle grass over the socks
    assert float(a @ ap.part_colour_vectors(grassy)["legs"]) > 0.9
    # and the masked part crop itself: grass pixels were replaced by the part's median colour, person pixels untouched
    masked = ap.part_crops(grassy)["legs"]
    legs = grassy[66:120]
    grass = ap._grass_mask(legs)
    fill = np.median(legs[~grass].reshape(-1, 3), axis=0)
    assert np.all(masked[grass] == fill)
    assert np.array_equal(masked[~grass], legs[~grass])


def test_part_embeddings_use_the_embedder_one_call_per_crop():
    """embed_parts batches a crop's parts into one embedder call; no embedder means all None."""
    calls = []

    class _Stub:
        def __call__(self, crops):
            calls.append(len(crops))
            out = []
            for c in crops:
                m = c.reshape(-1, 3).mean(0) / 255.0
                v = np.array([m[0], m[1], m[2], 1.0, 0.0, 0.0, 0.0, 0.0], np.float32)
                out.append(v / np.linalg.norm(v))
            return np.stack(out)

    got = ap.embed_parts(PLAYER_A, _Stub())
    assert calls == [3] and set(got) == {"head", "torso", "legs"}
    assert all(v is not None and abs(float(np.linalg.norm(v)) - 1.0) < 1e-5 for v in got.values())
    assert ap.embed_parts(PLAYER_A, None) == {"head": None, "torso": None, "legs": None}


def test_describe_part_based_is_off_by_default():
    """U.5 costs nothing unless enabled: part vectors stay None by default, and are filled when asked."""
    from vie_worker.tracker import Observation, Track

    def make():
        obs = [Observation(i, i * 100_000, 0.1, 0.1, 0.05, 0.2, 0.9, 1.0) for i in range(8)]
        t = Track(number=1, label="PERSON", shot_number=0, observations=obs, hits=len(obs), last_pts_us=obs[-1].pts_us)
        res = ap.CropReservoir(crops=[(i * 200_000, PLAYER_A) for i in range(4)])
        return t, {id(t): res}

    t, res = make()
    off = ap.describe([t], res, None)
    assert off[0].part_colours is None and off[0].part_embeddings is None
    t, res = make()
    on = ap.describe([t], res, None, part_based=True)
    assert set(on[0].part_colours) == {"head", "torso", "legs"} and on[0].part_embeddings is None  # no embedder: colours only

    class _Stub:
        def __call__(self, crops):
            return np.tile(np.array([1.0, 0.0, 0.0, 0.0], np.float32), (len(crops), 1))

    t, res = make()
    emb = ap.describe([t], res, _Stub(), part_based=True)
    assert set(emb[0].part_embeddings) == {"head", "torso", "legs"}
    assert all(v is not None for v in emb[0].part_embeddings.values())


def test_propose_links_can_use_part_similarity():
    """Same-kit crossing: whole-crop embeddings rank the WRONG later track first, part similarity ranks the
    right one first — and only when use_parts is asked for."""
    e = lambda v: np.array(v, np.float32) / np.linalg.norm(v)
    pa = ap.part_colour_vectors(PLAYER_A)
    pa2 = ap.part_colour_vectors(PLAYER_A2)
    pb = ap.part_colour_vectors(PLAYER_B)

    def mk(n, t0, t1, emb, parts):
        return ap.TrackAppearance(n, 0, t0, t1, 6, hist(2), np.zeros(3), e(emb), 0.9, group=0,
                                  part_colours=parts)

    a = mk(1, 0, 1_000_000, [1, 0, 0], pa)
    b = mk(2, 3_000_000, 4_000_000, [0.98, 0.2, 0], pb)      # wrong player, closer whole-crop
    c = mk(3, 3_500_000, 5_000_000, [0.7, 0.7, 0], pa2)      # right player, farther whole-crop
    plain = {(x["a"], x["b"]) for x in ap.propose_links([a, b, c])}
    assert plain == {(1, 2)}                                # whole-crop links the wrong player
    parted = ap.propose_links([a, b, c], use_parts=True)
    assert {(x["a"], x["b"]) for x in parted} == {(1, 3)}    # parts link the right one
    assert parted[0]["evidence"]["part_similarity"] > 0.9
