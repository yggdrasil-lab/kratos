#!/bin/bash
set -e

# Kratos Host Initialization
# Run on the Gaia manager before the first deploy: the database volume is a bind
# mount, so the directory has to exist on the node.
#
#   ./setup_host.sh

KRATOS_DB_DIR="${KRATOS_DB_MOUNT_PATH:-/opt/kratos/data}"

echo "[Info] Creating live database directory at: $KRATOS_DB_DIR"
sudo mkdir -p "$KRATOS_DB_DIR"
sudo chown -R "$USER":"$USER" "$KRATOS_DB_DIR"
sudo chmod 755 "$KRATOS_DB_DIR"

echo "[Success] Host directories initialised."
echo "You can now deploy the stack to the swarm."
