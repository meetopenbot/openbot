#!/bin/sh
# Fly mounts the volume at /data as root; chown so the node user can write workspaces.
if [ -d /data ]; then
  chown -R node:node /data
fi
exec su-exec node "$@"
