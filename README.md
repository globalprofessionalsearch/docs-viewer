A web app for viewing text documentation.  Point it at a directory and view in your browser.

> *Note:* This was put together relatively quickly for use as an internal tool.  It will be refactored eventually to include a proper build system and produce smaller production images.

## Usage ##

The server looks for documentation in `/docs`.  When the app loads, it scans the linked directory recursively and builds a navigable menu.  Clicking on a directory in the menu will display the available files in that directory across the top (minus file extension).  It treats `README.md` as an index file, and will automatically select that (if it exists), when you navigate to a new directory.  If one does not exist, it chooses the first file.

Notes on what types of files are handled at the moment:

* `*.md` - rendered as markdown
  * internal instances of `.lang-dot` will be automatically post-processed with `Viz.js`
  * inernal instances of `.lang-msgenny` - will be automatically post-processed with `mscgen`
* `*.dot` - renders with `Viz.js`
* `{api|swagger}.yml` - rendered with `swagger-ui` via an iframe

Each directory can provide some minimal customization via an option `.docs.json` file.  At the moment, this will only let you change the menu name of the directory, but more features may be supported in the future.  For example, if I have a directory named `/docs/examples`, that directory would be listed in the menu as `examples`.  If that directory contains a `.docs.json`, you could change the title used in the menu:

```json
{
  "title": "Usage examples"
}
```

The app also supports deep linking, which mirrors the structure of the documentation exactly.  So, if you have a file located at `<docs-root>/examples/foo.md` - you can put `/examples/foo.md` in your browser, and the app will load that file.

### Hot Reload ###

You may want to view and work on some documentation simultaneously.  The menu provides an option to turn on hot reloading when the underlying file changes.  If you turn this on and make edits to your files, the content area will automatically reload the new changes for the currently visible file.  This is particularly helpul when working on `graphviz` or `mscgen` diagrams.

## Developing ##

A docker-based dev environment is included so you shouldn't need to install anything locally, but you will need to map volumes accordingly when running the server.

* `docker-compose run --rm dev npm install`
* `docker-compose run --rm --service-ports -v '/path/to/docs:/docs' -v '/path/to/this/directory:/app' dev-server`

## Roadmap ##

This was built as an internal tool, so it's only under active development when a specific need arises.  That said, it will be refactored at some point to include a `webpack`-based build system, to ease dependency management.  More file types may be supported in the future as well, but that will be implemented on an as-needed basis.  If you want support for a new filetype, please submit an issue.