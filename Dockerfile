FROM node:22-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt ./
RUN python -m pip install --upgrade pip && \
    python -m pip install -r requirements.txt

COPY . .
COPY --from=frontend /app/static/mentor/react ./static/mentor/react

RUN DJANGO_SECRET_KEY=build-only-secret python manage.py collectstatic --noinput

EXPOSE 8000

CMD ["python", "start.py"]
