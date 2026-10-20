#!/usr/bin/env bash
set -euo pipefail

python -m pip install -r requirements.txt
npm ci --include=dev --prefix frontend
npm run build --prefix frontend
python manage.py collectstatic --noinput
python manage.py migrate --noinput
