FROM node:24-bookworm-slim

ARG PI_VERSION
RUN test -n "$PI_VERSION"

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates git ripgrep \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g --ignore-scripts "@earendil-works/pi-coding-agent@${PI_VERSION}" \
  && useradd --create-home --uid 10001 --shell /bin/bash pi

USER pi
WORKDIR /workspace

ENV HOME=/home/pi
ENTRYPOINT ["pi"]
