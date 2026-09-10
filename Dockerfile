FROM apify/actor-node:22

COPY --chown=myuser:myuser package*.json ./

RUN npm --quiet set progress=false \
	&& npm install --omit=dev --include=optional \
	&& node -e "import('impit').then((module) => console.log('impit OK:', Object.keys(module)))" \
	&& (npm list --omit=dev --all || true) \
	&& rm -rf ~/.npm

COPY --chown=myuser:myuser . ./

ENV APIFY_LOG_LEVEL=INFO

CMD npm start --silent
