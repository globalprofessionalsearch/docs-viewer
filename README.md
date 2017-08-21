A web app for viewing text documentation.  Point it at a directory and view in your browser.

> *Note:* This was put together relatively quickly for use as an internal tool.  It will be refactored eventually to include a proper build system and produce smaller production images.

## Usage ##

TODO: show docker examples:

* pull image and run by mapping local volume
* local dockerfile extending docs-viewer

## Developing ##

A docker-based dev environment is included so you shouldn't need to install anything locally, but you will need to map volumes accordingly when running the server.

* `docker-compose run --rm dev npm install`
* `docker-compose run --rm --service-ports -v '/path/to/docs:/docs' -v '/path/to/this/directory:/app' dev-server`