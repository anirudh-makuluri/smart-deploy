FROM docker.io/library/node@sha256:1200d815de24f8dcca745fbf7651d166034a35adbcad8860a8538ffff44f1420
WORKDIR /app
COPY --chown=10001:10001 config.js tunnel.js main.js ./
USER 10001:10001
ENV NODE_ENV=production
EXPOSE 8443
ENTRYPOINT ["node", "main.js"]
