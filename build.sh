#!/usr/bin/env bash
set -o errexit

npm ci --prefix frontend
npm run build --prefix frontend
python -m pip install --upgrade pip
pip install -r requirements.txt
python manage.py collectstatic --noinput
python manage.py migrate --noinput
