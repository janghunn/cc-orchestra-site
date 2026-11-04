#!/usr/bin/env bash
# Synthetic fixture: shell shapes that must never ship.
set -euo pipefail
ssh buildbox-zeta uptime
scp report.txt ubuntu@example-host:/srv/reports/
