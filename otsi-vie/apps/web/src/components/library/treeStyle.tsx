/** the Library tree's row and section-head classes (the tree and its Smart Bins section share them) */
export const treeRow = (on: boolean) => `flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left t-body ${on ? "bg-raised text-ink ring-1 ring-primary" : "text-ink2 hover:bg-raised"}`;
export const treeHead = "mt-3 mb-1 flex items-center justify-between px-1 t-th";
export const treeCount = "ml-auto t-mono text-[11px] text-muted";
