# Job de inicialización para Portainer/Swarm: migraciones (dbmate), semillas y bucket de MinIO.
# Reemplaza a los servicios migrate, seed y minio-init del docker-compose local.
# Se construye desde la raíz del repo.
FROM amacneil/dbmate:2.19.0 AS dbmate
FROM minio/mc:RELEASE.2025-04-16T18-13-26Z AS mc

FROM postgres:16.4-alpine
COPY --from=dbmate /usr/local/bin/dbmate /usr/local/bin/dbmate
COPY --from=mc /usr/bin/mc /usr/local/bin/mc
COPY db/migrations /db/migrations
COPY db/seeds /seeds
COPY minio /minio
COPY despliegue/init.sh /init.sh
ENTRYPOINT ["/bin/sh", "/init.sh"]
