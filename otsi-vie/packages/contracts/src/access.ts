import { z } from "zod";

/**
 * Project access (ADR-057, migration 0043; page 09 Collaborators / Manage Access). A project is open to everyone in the organization
 * (ORGANIZATION) or only to the people chosen for it (RESTRICTED). Owners and Admins always see every project. A project permission only
 * narrows what a person's organization role allows: a Viewer made Editor of a project still only views.
 */
export const ProjectAccessMode = z.enum(["ORGANIZATION", "RESTRICTED"]);
export type ProjectAccessMode = z.infer<typeof ProjectAccessMode>;
/** READ viewer, REVIEW reviewer (identity checks and notes), EDIT editor, ADMIN manager (also chooses who is on the project) */
export const ProjectPermission = z.enum(["READ", "REVIEW", "EDIT", "ADMIN"]);
export type ProjectPermission = z.infer<typeof ProjectPermission>;
export const PERMISSION_NAMES: Record<ProjectPermission, string> = { READ: "Viewer", REVIEW: "Reviewer", EDIT: "Editor", ADMIN: "Manager" };

export const Collaborator = z.object({ user_id: z.string().uuid(), display_name: z.string(), permission: ProjectPermission });
export type Collaborator = z.infer<typeof Collaborator>;

export const ProjectPerson = z.object({
  user_id: z.string().uuid(),
  display_name: z.string(),
  email: z.string().nullable(),
  /** organization role */
  role: z.string(),
  permission: ProjectPermission,
  /** what he can really do here: the lower of his organization role and his project permission */
  effective: z.enum(["VIEW", "REVIEW", "EDIT", "MANAGE"]),
  granted_by_name: z.string().nullable(),
  granted_at: z.string(),
});
export type ProjectPerson = z.infer<typeof ProjectPerson>;

export const ProjectAccessView = z.object({
  project_id: z.string().uuid(),
  access: ProjectAccessMode,
  can_manage: z.boolean(),
  people: z.array(ProjectPerson),
  /** active members not on the project yet (only for someone who can manage it) */
  addable: z.array(z.object({ user_id: z.string().uuid(), display_name: z.string(), role: z.string() })),
  /** Owners and Admins: they see every project whatever is chosen here */
  always: z.array(z.object({ user_id: z.string().uuid(), display_name: z.string(), role: z.string() })),
});
export type ProjectAccessView = z.infer<typeof ProjectAccessView>;

export const SetProjectAccessRequest = z.object({ access: ProjectAccessMode });
export type SetProjectAccessRequest = z.infer<typeof SetProjectAccessRequest>;
export const SetCollaboratorRequest = z.object({ permission: ProjectPermission });
export type SetCollaboratorRequest = z.infer<typeof SetCollaboratorRequest>;
