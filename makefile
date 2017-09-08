# NOTE: this does NOT also create and publish git tags - that should have
# already been done
publish-image:
	@if [ ! "$(TAG)" ]; then \
        echo "TAG was not specified"; \
        return 1; \
    fi

	# build the tagged image, and push to repo
	docker build -t globalprofessionalsearch/docs-viewer:latest . && \
	docker tag globalprofessionalsearch/docs-viewer:latest globalprofessionalsearch/docs-viewer:$(TAG) && \
	docker push globalprofessionalsearch/docs-viewer:$(TAG)
	docker push globalprofessionalsearch/docs-viewer:latest

.PHONY: publish-image