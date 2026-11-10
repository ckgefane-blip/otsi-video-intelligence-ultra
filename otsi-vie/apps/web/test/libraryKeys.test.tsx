/** Library: [ / ] move between the asset tabs (lib/keymap.ts, Library scope) */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { LibraryMain } from "@/components/library/LibraryMain";
import { NO_FILTERS } from "@/components/library/useLibrary";

vi.mock("@/lib/api", () => ({ api: () => Promise.reject(new Error("down")) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));

function Harness() {
  const [tab, setTab] = useState(0);
  return (
    <>
      <div data-testid="tab">{tab}</div>
      <input aria-label="field" />
      <LibraryMain all={[]} shown={[]} tab={tab} setTab={setTab} f={NO_FILTERS} setF={() => {}} desc={false} setDesc={() => {}}
        selected={null} select={() => {}} competitions={[]} teams={[]} reload={async () => {}} canWrite={false} members={[]} me={null}
        say={() => {}} folder={null} setFolder={() => {}} trash={false} setTrash={() => {}} newFolder={false} setNewFolder={() => {}} />
    </>
  );
}

describe("Library keys", () => {
  it("[ / ] move between the asset tabs and stop at the ends", () => {
    render(<Harness />);
    expect(screen.getByTestId("tab")).toHaveTextContent("0");
    fireEvent.keyDown(window, { key: "]" });
    expect(screen.getByTestId("tab")).toHaveTextContent("1");
    fireEvent.keyDown(window, { key: "]" });
    fireEvent.keyDown(window, { key: "]" });
    expect(screen.getByTestId("tab")).toHaveTextContent("3");
    fireEvent.keyDown(window, { key: "[" });
    expect(screen.getByTestId("tab")).toHaveTextContent("2");
    for (let i = 0; i < 10; i++) fireEvent.keyDown(window, { key: "]" });   // the last tab is 7 (eight tabs)
    expect(screen.getByTestId("tab")).toHaveTextContent("7");
    for (let i = 0; i < 10; i++) fireEvent.keyDown(window, { key: "[" });
    expect(screen.getByTestId("tab")).toHaveTextContent("0");
  });

  it("does nothing while typing in a field", () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByLabelText("field"), { key: "]" });
    expect(screen.getByTestId("tab")).toHaveTextContent("0");
  });
});
