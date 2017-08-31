var fs = require('fs');
var chokidar = require('chokidar');
var path = require('path');
var url = require('url');
var http = require('http');
var websocket = require('ws');
var express = require('express');

// TODO: add basic auth to everything, get user/pass from env variables

const IGNORE = [
  ".DS_Store",
  ".git",
  ".gitignore",
  ".gitconfig",
  ".editorconfig"
];

// recursively parse and load `docs.json` files from a starting point
function loadDocs(basePath, baseUrl, uiRoute) {
  var p = path.join(basePath, ".docs.json");

  var doc = {};

  // parse the `.docs.json` if it exists
  if (fs.existsSync(p)) {
    doc = JSON.parse(fs.readFileSync(p));
  }

  //parse the doc
  doc.items = [];
  doc.nested = {};
  doc.baseUrl = baseUrl;
  doc.basePath = basePath;
  doc.uiRoute = uiRoute;
  if (!doc.title) {
    doc.title = path.basename(basePath);
  }

  // check for subdirectories and recurse
  items = fs.readdirSync(basePath);
  if (items.length > 0) {
    for (var name of items) {
      if (-1 !== IGNORE.indexOf(name)) {
        continue;
      }
      
      var stat = fs.statSync(path.join(basePath, name))

      // NOTE: any future features for `.docs.json` files would likely be checked and handled here, eg
      //   * treating directories of images as an image gallery

      if (stat.isDirectory()) {
        ndoc = loadDocs(path.join(basePath, name), path.join(baseUrl, name), path.join(uiRoute, name));
        if (ndoc !== null) {
          doc.nested[name] = ndoc;
        }
      } else if (name !== ".docs.json") {
        doc.items.push(name);
      }
    }
  }

  return doc;
}

// create the express server and define routes
var app = express()
app.use('/_docs', express.static("/docs"));
app.use('/_node_modules', express.static("/app/node_modules"));
app.get('/_resources', function(req, res) {
  var docsIndex = loadDocs("/docs", "/_docs", "/");
  res.json(docsIndex);
});

// swagger-ui needs to be loaded via iframe because it expects
// to control the entire page - hence a dedicated index page for it
app.get('/_swagger-ui', function(req, res) {
  res.send(`
    <html>
      <head>
        <link href="/_node_modules/swagger-ui-dist/swagger-ui.css" rel="stylesheet" type="text/css">
        <script src="/_node_modules/swagger-ui-dist/swagger-ui-bundle.js"></script>
        <style>
          .swagger-ui .wrapper { padding: 0px; }
          .swagger-ui .markdown p, .swagger-ui .markdown pre { margin-bottom: 10px; }
        </style>
      </head>
      <body>
        <div id="swaggerui"></div>
        <script>
          const ui = SwaggerUIBundle({
            url: "${req.query.path}",
            dom_id: '#swaggerui'
          });
          window.ui = ui
        </script>
      </body>
    </html>
  `);
});

// app ui
app.use('/_app', express.static("/app/public"));

// wildcard route - app routing follows exact directory structure of the
// docs being served; so just serve the index.html, and the UI
// will route to the correct doc client-side
app.get('*', function (req, res) {
  res.sendFile('/app/public/index.html');
});


var server = http.createServer(app);

// set up the websocket server for file update tracking
var wss = new websocket.Server({server});
wss.on('connection', (ws, req) => {
  // listen for all change events and send to client
  var watcher = chokidar.watch('/docs', {ignored: /(^|[\/\\])\../}).on('change', (path, stat) => {
    ws.send(JSON.stringify({evt:'change', path:path}));
  });

  ws.on('close', () => {
    watcher.close();
  });
});

// listen for TERM (kill) & INT (ctrl-c)
process.on ('SIGTERM', () => { process.exit(); });
process.on ('SIGINT', () => { process.exit(); });

// start serving requests
server.listen(80);
console.log("... listening!");
