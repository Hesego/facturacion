# n8n con los workflows del flujo de gastos incluidos. Al arrancar importa credenciales y
# workflows (idempotente) y luego inicia n8n, así no hay que entrar al contenedor.
# Se construye desde la raíz del repo.
FROM n8nio/n8n:1.88.0
COPY --chown=node:node n8n/workflows /flujo/workflows
COPY --chown=node:node n8n/importar.sh despliegue/n8n-arranque.sh /flujo/
ENTRYPOINT ["tini", "--", "/bin/sh", "/flujo/n8n-arranque.sh"]
