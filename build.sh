#!/usr/bin/env bash
set -o errexit

python -m pip install --upgrade pip
pip install -r requirements.txt
python manage.py collectstatic --noinput
if ! python manage.py migrate --noinput; then
  echo "Warning: database migrations could not run; deploying without persistent learning reviews."
fi
