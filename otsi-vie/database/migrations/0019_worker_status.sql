-- 0019 worker resource status (OTSI VIE v2, MySQL 8.4) — Page 03 "System Resources", 2026-10-29
-- Each background worker process reports its machine's measured load every few seconds (psutil): CPU %, logical CPUs, memory used and
-- total, the GPU's name when the operating system reports one. GPU load is not measured (no free cross-vendor reading on Windows), so it
-- stays NULL rather than being estimated. Infrastructure status, not organization data: no organization_id. One row per worker process,
-- overwritten in place; a row older than a few seconds means that worker is gone. Forward-only: no data is changed or removed.
CREATE TABLE `worker_status` (
  `worker_id` VARCHAR(100) NOT NULL PRIMARY KEY,
  `host` VARCHAR(255) NOT NULL,
  `kinds` JSON NOT NULL,
  `cpu_percent` DECIMAL(5,2) NULL CHECK (`cpu_percent` BETWEEN 0 AND 100),
  `cpu_count` INT NULL CHECK (`cpu_count` > 0),
  `memory_used_bytes` BIGINT NULL CHECK (`memory_used_bytes` >= 0),
  `memory_total_bytes` BIGINT NULL CHECK (`memory_total_bytes` > 0),
  `gpu_name` VARCHAR(255) NULL,
  `gpu_percent` DECIMAL(5,2) NULL CHECK (`gpu_percent` BETWEEN 0 AND 100),
  `busy` BOOLEAN NOT NULL DEFAULT FALSE,
  `started_at` DATETIME(6) NOT NULL,
  `reported_at` DATETIME(6) NOT NULL,
  KEY `ix_worker_status_reported` (`reported_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
