FROM listmonk/listmonk:v6.1.0

EXPOSE 9000

CMD ["sh", "-c", "set -eu; export LISTMONK_app__address=\"${LISTMONK_app__address:-0.0.0.0:${PORT:-9000}}\"; export LISTMONK_db__host=\"${LISTMONK_db__host:-${PGHOST:-}}\"; export LISTMONK_db__port=\"${LISTMONK_db__port:-${PGPORT:-5432}}\"; export LISTMONK_db__user=\"${LISTMONK_db__user:-${PGUSER:-}}\"; export LISTMONK_db__password=\"${LISTMONK_db__password:-${PGPASSWORD:-}}\"; export LISTMONK_db__database=\"${LISTMONK_db__database:-${PGDATABASE:-}}\"; export LISTMONK_db__ssl_mode=\"${LISTMONK_db__ssl_mode:-require}\"; : \"${LISTMONK_db__host:?Set LISTMONK_db__host or PGHOST}\"; : \"${LISTMONK_db__user:?Set LISTMONK_db__user or PGUSER}\"; : \"${LISTMONK_db__password:?Set LISTMONK_db__password or PGPASSWORD}\"; : \"${LISTMONK_db__database:?Set LISTMONK_db__database or PGDATABASE}\"; ./listmonk --install --idempotent --yes --config='' && ./listmonk --upgrade --yes --config='' && exec ./listmonk --config=''"]
