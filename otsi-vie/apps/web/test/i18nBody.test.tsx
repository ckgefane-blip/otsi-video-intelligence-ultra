/**
 * Page-body translations through the provider (ADR-139 follow-up).
 * A wired component reads its strings from the dictionary the provider
 * supplies: with Russian stored, it shows Russian body strings; with
 * nothing stored it shows English. The TrustStrip is the probe — it is
 * purely presentational (no API call), so the test proves the wiring,
 * not the network.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LOCALE_STORAGE_KEY, LocaleProvider, useLocale } from "@/lib/i18n";
import { TrustStrip } from "@/components/home/TrustStrip";

function Probe() {
  const { t } = useLocale();
  return (
    <p>
      {t.body.home.viewAll} | {t.body.reels.saveProject} | {t.body.players.position} |{" "}
      {t.body.reports.notMeasured} | {t.body.exports.downloadAll} | {t.body.upload.recentUploads} |{" "}
      {t.body.processing.jobs}
    </p>
  );
}

/** Group B probe: Analysis workspace / Tactical / Clip Studio body strings. */
function ProbeB() {
  const { t } = useLocale();
  return (
    <p>
      {t.body.studio.splitTool} | {t.body.studio.rippleDelete} | {t.body.studio.speedSection} |{" "}
      {t.body.studio.waveformLabel} | {t.body.studio.frameRow} | {t.body.studio.deleteBtn} |{" "}
      {t.body.tactics.colourGroupN.replace("{a}", "2")} |{" "}
      {t.body.studio.suggestedMomentsAdded.replace("{a}", "3")} |{" "}
      {t.body.workspace.matchTitleVs.replace("{a}", "Home").replace("{b}", "Away")}
    </p>
  );
}

describe("page bodies through the provider (ADR-139 follow-up)", () => {
  it("a component reads body strings from the stored locale (Russian)", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "ru");
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByText("Смотреть все | Сохранить проект | Позиция | Не измерено | Скачать всё | Недавние загрузки | Задания")).toBeDefined();
  });

  it("a component reads body strings from the stored locale (Spanish)", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "es");
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByText("Ver todo | Guardar proyecto | Posición | No medido | Descargar todo | Subidas recientes | Trabajos")).toBeDefined();
  });

  it("with no stored locale a component reads the English body strings", () => {
    localStorage.removeItem(LOCALE_STORAGE_KEY);
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByText("View All | Save Project | Position | Not measured | Download All | Recent Uploads | Jobs")).toBeDefined();
  });

  it("a wired page section shows its translated heading (Russian)", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "ru");
    render(
      <LocaleProvider>
        <TrustStrip />
      </LocaleProvider>,
    );
    expect(screen.getByText("НАДЁЖНЫЕ ПАРТНЁРЫ")).toBeDefined();
    expect(screen.getByText("Создано для клубов, академий и скаутов")).toBeDefined();
  });

  it("Group B strings read from the stored locale (Russian)", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "ru");
    render(
      <LocaleProvider>
        <ProbeB />
      </LocaleProvider>,
    );
    expect(screen.getByText("Разделить (S) | Удалить со сдвигом | Скорость | Волна | Кадр | Удалить | Цветовая группа 2 | Добавлено предложенных моментов: 3 | Home — Away")).toBeDefined();
  });

  it("Group B strings read from the stored locale (Spanish)", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "es");
    render(
      <LocaleProvider>
        <ProbeB />
      </LocaleProvider>,
    );
    expect(screen.getByText("Dividir (S) | Eliminar en cadena | Velocidad | Onda | Encuadre | Eliminar | Grupo de color 2 | 3 momentos sugeridos añadidos | Home vs Away")).toBeDefined();
  });
});
