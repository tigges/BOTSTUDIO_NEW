#!/bin/sh
# Bring the database schema up to date. Exits non-zero instead of starting
# the API on a schema that does not match the code.
#
# Databases created before migrations were tracked (by `prisma db push`) have
# no migration history. They are brought in line with schema.prisma by a
# db push that refuses any change that would drop data, then marked as being
# at the baseline, after which normal `migrate deploy` takes over.
set -u

SCHEMA="${SCHEMA:-packages/db/prisma/schema.prisma}"
BASELINE="20261020_baseline"
PRISMA="${PRISMA:-prisma}"

deploy() {
  OUT=$($PRISMA migrate deploy --schema "$SCHEMA" 2>&1)
  STATUS=$?
  echo "$OUT"
  return $STATUS
}

adopt_existing_database() {
  echo "[migrate] existing database without migration history; adopting baseline ${BASELINE}"
  if ! $PRISMA db push --schema "$SCHEMA" --skip-generate; then
    echo "[migrate] db push would drop data or failed; fix the schema difference by hand, then restart" >&2
    exit 1
  fi
  $PRISMA migrate resolve --schema "$SCHEMA" --rolled-back "$BASELINE" >/dev/null 2>&1 || true
  $PRISMA migrate resolve --schema "$SCHEMA" --applied "$BASELINE" || exit 1
}

echo "[migrate] applying database migrations..."
if deploy; then
  echo "[migrate] OK"
  exit 0
fi

case "$OUT" in
  *P3005*|*P3018*"$BASELINE"*|*P3009*"$BASELINE"*)
    adopt_existing_database
    if deploy; then
      echo "[migrate] OK"
      exit 0
    fi
    ;;
esac

echo "[migrate] migrate deploy failed; the API will not start on an out-of-date schema" >&2
exit 1
