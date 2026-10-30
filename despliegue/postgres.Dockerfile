# PostgreSQL con el script que crea roles y bases (corre solo cuando el volumen está vacío).
# Para Portainer/Swarm, donde no se puede montar ./db/init. Se construye desde la raíz del repo.
FROM postgres:16.4-alpine
COPY db/init/ /docker-entrypoint-initdb.d/
