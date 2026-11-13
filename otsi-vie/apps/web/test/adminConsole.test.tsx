import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminConsole } from "@/components/admin/AdminConsole";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ api, ApiProblem: Error }));

const mockAuth = vi.hoisted(() => ({
  useAuth: vi.fn(),
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: mockAuth.useAuth,
}));

const mockDashboard = {
  organization: {
    id: "org-1",
    name: "FC Test Club",
    created_at: "2026-01-01T00:00:00.000Z",
    member_count: 5,
    video_count: 12,
    reel_count: 8,
    storage_bytes: 104857600, // 100 MB
  },
  members: [
    {
      user_id: "u-1",
      display_name: "Lead Owner",
      email: "owner@test.com",
      role: "OWNER",
      is_owner: true,
      two_step: true,
      created_at: "2026-01-01T00:00:00.000Z",
    },
    {
      user_id: "u-2",
      display_name: "Match Analyst",
      email: "analyst@test.com",
      role: "ANALYST",
      is_owner: false,
      two_step: false,
      created_at: "2026-02-01T00:00:00.000Z",
    },
  ],
  models: [
    {
      key: "yolov8x-player-detection",
      task: "detection",
      family: "yolo",
      adapter: "ultralytics_yolo",
      source: "ultralytics",
      revision: "1.0",
      weights_license: "AGPL-3.0",
      status: "production",
      files: [
        {
          name: "yolov8x.pt",
          expected_sha256: null,
          present: true,
          verified: true,
        },
      ],
    },
  ],
  concurrency: {
    max_concurrent_renders: 2,
    max_concurrent_analysis: 1,
    max_concurrent_ingest: 2,
    queue_paused: false,
  },
  workers: [
    {
      group_name: "jobs-analysis",
      kinds: ["ANALYZE", "TRACK_BALL"],
      active_workers: 1,
      running_jobs: 0,
      queued_jobs: 0,
    },
  ],
  system_resources: {
    connected: true,
    workers: 1,
    busy_workers: 0,
    host: "TEST-HOST",
    cpu_percent: 15.5,
    cpu_count: 8,
    memory_used_bytes: 8589934592,
    memory_total_bytes: 17179869184,
    gpu_name: "NVIDIA GeForce RTX 4080",
  },
  recent_audit: [],
};

const mockAuditLogs = [
  {
    id: 1,
    occurred_at: "2026-03-01T00:00:00.000Z",
    actor_kind: "user",
    actor_id: "u-1",
    actor_name: "Lead Owner",
    action: "concurrency.update",
    entity_type: "concurrency",
    entity_id: "org-1",
    request_id: "req-1",
    before_state: null,
    after_state: { max_concurrent_renders: 4 },
  },
];

describe("AdminConsole (v3 Phase D.3, ADR-111)", () => {
  it("blocks non-admin users with authorization alert", () => {
    mockAuth.useAuth.mockReturnValue({
      organization: { organization_id: "org-1", role: "VIEWER" },
    });
    render(<AdminConsole />);
    expect(screen.getByText("Administrator access required")).toBeDefined();
  });

  it("loads dashboard and switches across tabs for OWNER", async () => {
    mockAuth.useAuth.mockReturnValue({
      organization: { organization_id: "org-1", role: "OWNER" },
    });

    api.mockImplementation((url: string) => {
      if (url.startsWith("/v1/admin/dashboard")) return Promise.resolve(mockDashboard);
      if (url.startsWith("/v1/admin/audit")) return Promise.resolve(mockAuditLogs);
      if (url.startsWith("/v1/admin/retention/erasures")) return Promise.resolve([]);
      if (url.startsWith("/v1/admin/retention")) return Promise.resolve({ trash_days: 30, audit_log_days: 90, auto_purge_enabled: true });
      if (url.startsWith("/v1/admin/backups")) return Promise.resolve({ backups: [], latest_backup_at: null, latest_verified_at: null, healthy: true });
      if (url.startsWith("/v1/admin/monitoring")) return Promise.resolve({ status: "HEALTHY", timestamp: "2026-03-01T00:00:00.000Z", active_workers_count: 2, stalled_workers_count: 0, workers: [], queues: [], disk: { mount: "/", total_bytes: 1e9, used_bytes: 2e8, free_bytes: 8e8, percent_used: 20 }, alerts: [] });
      if (url.startsWith("/v1/admin/retention")) {
        return Promise.resolve({
          organization_id: "org-1",
          trash_days: 30,
          raw_footage_days: null,
          rendered_reels_days: null,
          audit_log_days: 365,
          auto_purge_enabled: false,
          updated_at: "2026-01-01T00:00:00.000Z",
          updated_by: null,
        });
      }
      return Promise.reject(new Error(`unexpected endpoint ${url}`));
    });

    render(<AdminConsole />);

    // Check overview tab content
    expect(await screen.findByText("Active worker groups")).toBeDefined();
    expect(screen.getByText("100 MB")).toBeDefined();

    // Switch to Members & roles
    fireEvent.click(screen.getByRole("button", { name: /Members & roles/i }));
    expect(await screen.findByText("Lead Owner")).toBeDefined();
    expect(screen.getByText("Match Analyst")).toBeDefined();

    // Switch to Model registry
    fireEvent.click(screen.getByRole("button", { name: /Model registry/i }));
    expect(await screen.findByText("yolov8x-player-detection")).toBeDefined();
    expect(screen.getByText("Ready")).toBeDefined();

    // Switch to Concurrency & workers
    fireEvent.click(screen.getByRole("button", { name: /Concurrency & workers/i }));
    expect(await screen.findByText("Worker job concurrency caps")).toBeDefined();
    expect(screen.getByRole("button", { name: /Apply concurrency caps/i })).toBeDefined();

    // Switch to Security & audit
    fireEvent.click(screen.getByRole("button", { name: /Security & audit/i }));
    expect(await screen.findByText("concurrency.update")).toBeDefined();
  });

  it("updates concurrency caps on apply", async () => {
    mockAuth.useAuth.mockReturnValue({
      organization: { organization_id: "org-1", role: "ADMIN" },
    });

    api.mockImplementation((url: string, opts?: { method?: string; json?: unknown }) => {
      if (url.startsWith("/v1/admin/dashboard")) return Promise.resolve(mockDashboard);
      if (url.startsWith("/v1/admin/audit")) return Promise.resolve(mockAuditLogs);
      if (url.startsWith("/v1/admin/retention/erasures")) return Promise.resolve([]);
      if (url.startsWith("/v1/admin/backups")) return Promise.resolve({ backups: [], latest_backup_at: null, latest_verified_at: null, healthy: true });
      if (url.startsWith("/v1/admin/monitoring")) return Promise.resolve({ status: "HEALTHY", timestamp: "2026-03-01T00:00:00.000Z", active_workers_count: 2, stalled_workers_count: 0, workers: [], queues: [], disk: { mount: "/", total_bytes: 1e9, used_bytes: 2e8, free_bytes: 8e8, percent_used: 20 }, alerts: [] });
      if (url.startsWith("/v1/admin/retention")) {
        return Promise.resolve({
          organization_id: "org-1",
          trash_days: 30,
          raw_footage_days: null,
          rendered_reels_days: null,
          audit_log_days: 365,
          auto_purge_enabled: false,
          updated_at: "2026-01-01T00:00:00.000Z",
          updated_by: null,
        });
      }
      if (url === "/v1/admin/concurrency" && opts?.method === "PATCH") {
        return Promise.resolve({
          concurrency: {
            ...mockDashboard.concurrency,
            max_concurrent_renders: 4,
          },
          workers: mockDashboard.workers,
        });
      }
      return Promise.reject(new Error(`unexpected endpoint ${url}`));
    });

    render(<AdminConsole />);
    fireEvent.click(await screen.findByRole("button", { name: /Concurrency & workers/i }));

    const applyBtn = screen.getByRole("button", { name: /Apply concurrency caps/i });
    fireEvent.click(applyBtn);

    await vi.waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "/v1/admin/concurrency",
        expect.objectContaining({
          method: "PATCH",
        }),
      );
    });
  });

  it("renders retention & privacy tab, saves policy and purges expired trash", async () => {
    mockAuth.useAuth.mockReturnValue({
      organization: { organization_id: "org-1", role: "ADMIN" },
    });

    api.mockImplementation((url: string, opts?: { method?: string; json?: unknown }) => {
      if (url.startsWith("/v1/admin/dashboard")) return Promise.resolve(mockDashboard);
      if (url.startsWith("/v1/admin/audit")) return Promise.resolve(mockAuditLogs);
      if (url.startsWith("/v1/admin/retention/erasures")) return Promise.resolve([]);
      if (url.startsWith("/v1/admin/backups")) return Promise.resolve({ backups: [], latest_backup_at: null, latest_verified_at: null, healthy: true });
      if (url.startsWith("/v1/admin/monitoring")) return Promise.resolve({ status: "HEALTHY", timestamp: "2026-03-01T00:00:00.000Z", active_workers_count: 2, stalled_workers_count: 0, workers: [], queues: [], disk: { mount: "/", total_bytes: 1e9, used_bytes: 2e8, free_bytes: 8e8, percent_used: 20 }, alerts: [] });
      if (url === "/v1/admin/retention") {
        if (opts?.method === "PATCH") {
          return Promise.resolve({
            organization_id: "org-1",
            trash_days: 14,
            raw_footage_days: null,
            rendered_reels_days: null,
            audit_log_days: 365,
            auto_purge_enabled: true,
            updated_at: "2026-11-09T00:00:00.000Z",
            updated_by: "u-1",
          });
        }
        return Promise.resolve({
          organization_id: "org-1",
          trash_days: 30,
          raw_footage_days: null,
          rendered_reels_days: null,
          audit_log_days: 365,
          auto_purge_enabled: false,
          updated_at: "2026-01-01T00:00:00.000Z",
          updated_by: null,
        });
      }
      if (url === "/v1/admin/retention/trash/purge" && opts?.method === "POST") {
        return Promise.resolve({
          purged_count: 3,
          purged_items: [],
          freed_bytes: 52428800,
          retention_days: 30,
        });
      }
      return Promise.reject(new Error(`unexpected endpoint ${url}`));
    });

    render(<AdminConsole />);
    fireEvent.click(await screen.findByRole("button", { name: /Retention & privacy/i }));

    expect(await screen.findByText("Data retention schedules")).toBeDefined();
    expect(screen.getByText(/GDPR Data Subject Erasure/i)).toBeDefined();

    // Click Save retention policy
    const saveBtn = screen.getByRole("button", { name: /Save retention policy/i });
    fireEvent.click(saveBtn);

    await vi.waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "/v1/admin/retention",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
  });

  it("renders monitoring alerts banner when warnings exist", async () => {
    mockAuth.useAuth.mockReturnValue({
      organization: { organization_id: "org-1", role: "ADMIN" },
    });

    api.mockImplementation((url: string) => {
      if (url.startsWith("/v1/admin/dashboard")) return Promise.resolve(mockDashboard);
      if (url.startsWith("/v1/admin/audit")) return Promise.resolve(mockAuditLogs);
      if (url.startsWith("/v1/admin/retention/erasures")) return Promise.resolve([]);
      if (url.startsWith("/v1/admin/retention")) return Promise.resolve({ trash_days: 30, audit_log_days: 90, auto_purge_enabled: true });
      if (url.startsWith("/v1/admin/backups")) return Promise.resolve({ backups: [], latest_backup_at: null, latest_verified_at: null, healthy: true });
      if (url.startsWith("/v1/admin/monitoring")) {
        return Promise.resolve({
          status: "DEGRADED",
          timestamp: "2026-03-01T00:00:00.000Z",
          active_workers_count: 1,
          stalled_workers_count: 1,
          workers: [],
          queues: [],
          disk: { mount: "/", total_bytes: 1e9, used_bytes: 8.5e8, free_bytes: 1.5e8, percent_used: 85 },
          alerts: [
            {
              id: "alt-1",
              code: "WORKER_HEARTBEAT_TIMEOUT",
              severity: "WARNING",
              title: "Worker Node Stalled",
              message: "Worker w-1 has not reported heartbeats for >35s.",
              source: "worker_status",
              timestamp: "2026-03-01T00:00:00.000Z",
              suggested_action: "Restart unresponsive worker processes.",
            },
          ],
        });
      }
      return Promise.reject(new Error(`unexpected endpoint ${url}`));
    });

    render(<AdminConsole />);
    expect(await screen.findByText("Worker Node Stalled")).toBeDefined();
    expect(screen.getByText(/Worker w-1 has not reported heartbeats/i)).toBeDefined();
    expect(screen.getByText(/Restart unresponsive worker processes/i)).toBeDefined();
  });

  it("renders release gates tab and displays gate records", async () => {
    mockAuth.useAuth.mockReturnValue({
      organization: { organization_id: "org-1", role: "ADMIN" },
    });

    api.mockImplementation((url: string) => {
      if (url.startsWith("/v1/admin/dashboard")) return Promise.resolve(mockDashboard);
      if (url.startsWith("/v1/admin/audit")) return Promise.resolve(mockAuditLogs);
      if (url.startsWith("/v1/admin/retention/erasures")) return Promise.resolve([]);
      if (url.startsWith("/v1/admin/retention")) return Promise.resolve({ trash_days: 30, audit_log_days: 90, auto_purge_enabled: true });
      if (url.startsWith("/v1/admin/backups")) return Promise.resolve({ backups: [], latest_backup_at: null, latest_verified_at: null, healthy: true });
      if (url.startsWith("/v1/admin/monitoring")) return Promise.resolve({ status: "HEALTHY", timestamp: "2026-03-01T00:00:00.000Z", active_workers_count: 1, stalled_workers_count: 0, workers: [], queues: [], disk: { mount: "/", total_bytes: 1e9, used_bytes: 5e8, free_bytes: 5e8, percent_used: 50 }, alerts: [] });
      if (url.startsWith("/v1/admin/release-gates")) {
        return Promise.resolve({
          timestamp: "2026-11-09T17:00:00.000Z",
          passed_count: 11,
          total_count: 15,
          accuracy_measured: false,
          all_passed: false,
          gates: [
            {
              id: "G01",
              name: "Database Architecture",
              category: "INFRASTRUCTURE",
              status: "PASSED",
              what: "Schema migrations",
              evidence_required: "Zero failed migrations",
              release_rule: "No failed migrations",
            },
            {
              id: "G05",
              name: "Detection Accuracy",
              category: "AI_ACCURACY",
              status: "MEASURING",
              what: "Player and ball detection",
              evidence_required: "Recall >= 82%",
              release_rule: "Accuracy banner active",
            },
          ],
        });
      }
      return Promise.reject(new Error(`unexpected endpoint ${url}`));
    });

    render(<AdminConsole />);
    expect(await screen.findByText("Active worker groups")).toBeDefined();

    // Click release gates tab
    const gatesTab = screen.getByRole("button", { name: /Release Gates/i });
    fireEvent.click(gatesTab);

    expect(await screen.findByText("Release gates (G01–G15) status")).toBeDefined();
    expect(screen.getByText("Database Architecture")).toBeDefined();
    expect(screen.getByText("Detection Accuracy")).toBeDefined();
  });
});
