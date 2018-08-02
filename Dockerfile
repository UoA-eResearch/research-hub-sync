FROM        node:alpine

# Required to install dependencies behind a proxy
ARG         http_proxy
ARG         https_proxy

WORKDIR     /app

COPY        package.json .
RUN         npm install

COPY        *.js .
ENTRYPOINT  tail -f /dev/null
