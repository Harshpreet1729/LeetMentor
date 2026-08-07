#!/usr/bin/env bash
set -o errexit

python -m pip install --upgrade pip
pip install -r requirements.txt
python manage.py collectstatic --noinput

# Learning-review storage is optional; an expired free Render Postgres instance
# must not prevent the core mentor workspace from deploying. A later deploy will
# apply migrations normally once DATABASE_URL points to a healthy database.
if ! python manage.py migrate --noinput; then
  echo "Warning: database migrations could not run; deploying without persistent learning reviews."
fi
