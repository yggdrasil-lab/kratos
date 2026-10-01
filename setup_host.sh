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

echo "[Info] Creating live database directory at: $KRATOS_DB_DIR"
sudo mkdir -p "$KRATOS_DB_DIR"
# 1000:1000 matches the fleet convention — apollo-core's jellystat-db is the
# other gaia Postgres bind mount and its setup script does the same. The postgres
# entrypoint starts as root, chowns PGDATA to the postgres user and chmods it
# 00700, so a directory owned any other way is simply re-owned on first init.
sudo chown -R 1000:1000 "$KRATOS_DB_DIR"
sudo chmod 755 "$KRATOS_DB_DIR"

echo "[Success] Host directories initialised."
echo "You can now deploy the stack to the swarm."
