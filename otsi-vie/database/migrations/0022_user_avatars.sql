-- 0022 profile photo (OTSI VIE v2, MySQL 8.4) — header account, 2026-10-30
-- A signed-in person can set a small photo for their own account. It is account-level (it follows the person into every organization),
-- so it lives beside `users`, not in an organization-scoped table. The web app shrinks the picture to a small square before sending it;
-- the database refuses anything but JPEG / PNG / WebP up to 400 KB. Removing the photo deletes only this row. Forward-only: no existing row changes.
CREATE TABLE `user_avatars` (
  `user_id` CHAR(36) NOT NULL PRIMARY KEY,
  `mime` VARCHAR(32) NOT NULL,
  `image` MEDIUMBLOB NOT NULL,
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT `fk_avatar_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_avatar_mime` CHECK (`mime` IN ('image/jpeg','image/png','image/webp')),
  CONSTRAINT `ck_avatar_size` CHECK (OCTET_LENGTH(`image`) <= 409600)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
