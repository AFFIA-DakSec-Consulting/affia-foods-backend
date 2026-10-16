-- AlterEnum
CREATE TYPE "Role_new" AS ENUM ('CLIENT', 'VENDOR', 'DRIVER', 'ADMIN');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING (CASE WHEN "role"::text = 'STUDENT' THEN 'CLIENT'::"Role_new" ELSE "role"::text::"Role_new" END);
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "Role_old";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'CLIENT';
