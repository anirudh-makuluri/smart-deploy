FROM docker.io/library/node@sha256:1200d815de24f8dcca745fbf7651d166034a35adbcad8860a8538ffff44f1420
WORKDIR /app
COPY --chown=10001:10001 server.mjs index.html client.js style.css ./
ARG NOTES_RELEASE
ENV NODE_ENV=production PORT=3000 NOTES_RELEASE=${NOTES_RELEASE}
USER 10001:10001
EXPOSE 3000
CMD ["node", "server.mjs"]
