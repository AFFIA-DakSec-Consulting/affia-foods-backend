#!/bin/sh
# Démarrage du conteneur : migrations Prisma puis serveur.
set -e

# Sur une base NEUVE, les migrations 20260904_align_legacy_schema et 20260904_clear_legacy_gate_otps
# (prévues pour les anciennes bases créées par `db push`) passent avant la migration initiale
# 20260904_make_order_otp_nullable (ordre alphabétique) et échouent faute de tables. La migration
# initiale crée déjà le schéma qu'elles visent : on les marque comme appliquées sans les exécuter.
FRESH=$(node -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.$queryRawUnsafe(`SELECT to_regclass($$public."User"$$) IS NULL AS fresh`)
  .then((r) => { console.log(r[0].fresh ? "yes" : "no"); return p.$disconnect(); })
  .catch((e) => { console.error(e.message); process.exit(1); });
')

if [ "$FRESH" = "yes" ]; then
  echo "Base neuve : les migrations legacy 20260904 sont marquées comme appliquées."
  npx prisma migrate resolve --applied 20260904_align_legacy_schema
  npx prisma migrate resolve --applied 20260904_clear_legacy_gate_otps
fi

npx prisma migrate deploy
exec node dist/index.js
