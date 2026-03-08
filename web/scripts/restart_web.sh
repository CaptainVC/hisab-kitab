#!/usr/bin/env bash
set -euo pipefail

systemctl --user daemon-reload
systemctl --user restart hisab-kitab-web.service
systemctl --user status hisab-kitab-web.service --no-pager | sed -n '1,16p'
