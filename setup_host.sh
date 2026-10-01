#!/bin/bash
set -e

# Kratos Host Initialization
# The database stores its data on a bind mount, so the source directory has to
# exist on the node before the stack can start.
#
#   ./setup_host.sh
#
# The deploy workflow creates this directory as well (see
# .github/workflows/deploy.yml), so this script is only needed if you want the
# directory in place before the first deploy, or you are deploying by hand.

KRATOS_DB_DIR="${KRATOS_DB_MOUNT_PATH:-/opt/kratos/data}"

# Ownership is deliberately left alone here.
#
# The postgres entrypoint starts as root and, on every start, runs
#
#   find "$PGDATA" ! -user postgres -exec chown postgres '{}' +
#   chmod 00700 "$PGDATA"
#
# so PGDATA ends up owned by postgres no matter what this script does. Chowning
# it ourselves adds nothing on a fresh directory, and chowning it -R on a
# directory that already holds a database re-owns live files out from under a
# running server, which then dies with:
#
#   FATAL: could not open file "global/pg_filenode.map": Permission denied
#
# Only ever create the directory, and never touch what is already inside it.
if [ -d "$KRATOS_DB_DIR" ]; then
  echo "[Info] $KRATOS_DB_DIR already exists; leaving it untouched."
else
  echo "[Info] Creating live database directory at: $KRATOS_DB_DIR"
  sudo mkdir -p "$KRATOS_DB_DIR"
fi

echo "[Success] Host directories initialised."
echo "You can now deploy the stack to the swarm."
