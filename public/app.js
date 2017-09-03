// setup Vue
Vue.use(Vuetify);

/////
//      Define Vue components
/////

Vue.component('app', {
  template: '#tmpl-app',
  props: ['menu'],
  created () {
    this.navToPath(window.location.pathname+window.location.hash, true);

    window.onpopstate = (e) => {
      this.navToPath(window.location.pathname+window.location.hash, false);
    };

    // set up websocket listener to detect file changes
    window.ws.addEventListener('message', (msg) => {
      if (!this.reloadFileChanges) {
        return;
      }

      try {
        var e = JSON.parse(msg.data);
      } catch (e) {
        console.error('received bad input: ', data);
        return;
      }

      // force reload the page component if
      // the current file was modified
      if (this.currentPath == e.path) {
        if (this.$refs.page && this.$refs.page.update) {
          this.$refs.page.update();
        }
      }
    });
  },
  data () {
    return {
      selectedItem: null,
      selectedFile: null,
      pageComponent: 'page-markdown',
      showMenu: true,
      reloadFileChanges: false
    };
  },
  computed: {
    currentPath: function () {
      return this.selectedItem.basePath + '/' + this.selectedFile;
    }
  },
  methods: {
    itemMenuName: function(name) {
      var parts = name.split('.');
      if (parts.length == 1) {
        return parts[0];
      }
      parts.pop();
      return parts.join('.');
    },
    navToItem: function(item) {
      this.navToPath(item.uiRoute);
    },
    navToPath: function(path, updateHistory) {
      if (updateHistory == null || updateHistory == undefined) {
        updateHistory = true;
      }

      // make sure scrollTop is reset
      document.querySelector('body').scrollTop = 0;
      
      // detect and preserve hash location
      var parts = path.split("#");
      var hash = "";
      if (parts.length == 2) {
        path = parts[0];
        hash = parts[1];
      }

      //clean path of trailing slash
      var parts = path.split("/");
      if (parts.pop() == "") {
        path = parts.join("/");
      }
      if (path == "") {
        path = "/";
      }
      
      // received path could have been page-relative, so convert to full path
      if (path[0] != "/") {
        path = this.selectedItem.uiRoute + '/' + path;
      }
      // hack to ensure path doesn't start with '//'
      if (path[1] == "/") {
        path = path.substr(1);
      }

      // we update the browser history now, even if the path ends up being invalid:
      if (updateHistory) {
        var hist = (hash != "") ? path+"#"+hash : path;
        history.pushState({}, "", path);
      }

      // lookup path in the menu index
      if (!window.pathIndex[path]) {
        this.selectedItem = null;
        this.selectedFile = null;
        this.pageComponent = 'page-missing';
        return;
      }

      // determine target item & target file
      var targetItem = window.pathIndex[path];
      var targetFile = null;
      if (targetItem.uiRoute !== path) {
        targetFile = path.split('/').pop();
      }

      // if target location is the same, no-op
      if (targetItem == this.selectedItem && targetFile == this.selectedFile) {
        return;
      }

      // otherwise, update the selected item and file
      if (this.selectedItem) {
        this.selectedItem.selected = false;
      }
      if (!targetItem.hasOwnProperty('selected')) {
        this.$set(targetItem, 'selected', true);
      }
      this.selectedItem = targetItem;
      this.selectedItem.selected = true;

      // check for empty target file and select a default
      if (targetFile == null) {
        if (-1 != targetItem.items.indexOf('README.md')) {
          this.selectedFile = 'README.md';
        } else {
          this.selectedFile = targetItem.items.length > 0 ? targetItem.items[0] : null;
        }
      } else {
        this.selectedFile = targetFile;
      }

      // select which page component should load based on the item & file
      this.pageComponent = choosePageComponent(this.selectedItem, this.selectedFile);

      // hacky, but if there was a hash location, set it after the page renders to
      // trigger the browser scroll
      if (hash !== "") {
        setTimeout(() => {
          window.location.hash = "#"+hash;
        });
      }
    }
  }
});

Vue.component('main-menu-item', {
  template: '#tmpl-main-menu-item',
  props: ['item', 'level'],
  methods: {
    emit: function(item) {
      this.$emit('selected-item', item);
    }
  }
});

var pageStateMixin = {
  created () {
    this.update();
  },
  beforeDestroy() {
    this.$emit('unloading');
  },
  props: ['item', 'file'],
  watch: {
    'item.baseUrl': function() { this.update(); },
    'file': function() { this.update(); }
  },
  computed: {
    contentUrl: function () { return this.item.baseUrl + "/" + this.file; }
  },
  methods: {
    // pages provide their own update methods
    update: function() {}
  }
}

Vue.component('page-markdown', {
  template: '#tmpl-page-markdown',
  mixins: [pageStateMixin],
  data () {
    return {
      html: null,
      showToc: false,
      parsedMscgen: {}
    };
  },

  // after the markdown is rendered, it is post processed
  // in several ways to convert embedded content into
  // viewable svg, and embed a table of contents
  updated () {
    // are the headers - render table of contents if so
    if (this.html !== null && this.html != "") {
      var headers = document.getElementById('markdown-content').querySelectorAll('h1,h2,h3,h4,h5,h6');
      if (headers.length > 0) {
        tocbot.init({
          contentSelector: '#markdown-content',
          tocSelector: '#markdown-toc',
          headingSelector: 'h1,h2,h3,h4,h5,h6'
        });
        this.showToc = true;
      } else {
        tocbot.destroy();
        this.showToc = false;
      }
    }

    // are there `dot` codeblocks?  Replace w/ rendered SVG
    document.querySelectorAll('.lang-dot').forEach(function(el) {
      var svg = Viz(el.textContent);
      el.innerHTML = svg;
    });

    // are there `mscgenny` codeblocks?  Replaec w/ rendered SVG
    const els = document.querySelectorAll('.lang-msgenny').forEach((el, i) => {
      // make sure it doesn't already have an svg
      if (null != el.querySelector('svg')) {
        return;
      }

      // and return if id was already parsed
      let id = 'lang-msgenny'+'-'+i;
      if (this.parsedMscgen[id] === true) {
        return;
      }
      this.parsedMscgen[id] = true;
      el.id = id;
      const ast = window.msc.msgennyparser.parse(el.textContent);
      el.innerHTML = "";
      window.msc.mscrender.renderAST(ast,null, id, window);
    });
    
    document.querySelectorAll('.lang-msc').forEach(function(el) {
      // TODO: support msc as well, refactor above
    });
  },
  methods: {
    update: function() {
      this.parsedMscgen = {};

      ajaxGet(this.contentUrl, (res) => {
        var html = marked(res, {
          gfm: true,
          tables:true,
          highlight: function (code) {
            return hljs.highlightAuto(code).value;
          }
        });

        this.html = html;
      });
    }
  }
});

// multiple page types result in rendering an SVG, so
// some of that is abstracted into a shared mixin
var pageSvgMixin = {
  template: '#tmpl-page-svg',
  data () {
    return {
      svg: null
    }
  },
  updated () {
    svgPanZoom('#svg-target svg');
  }
}

// renders an svg page from a .dot file
Vue.component('page-dot', {
  mixins: [pageStateMixin, pageSvgMixin],
  updated () {
    console.log('yep');
  },
  methods: {
    update: function () {
      ajaxGet(this.contentUrl, (dotStr) => {
        var svg = Viz(dotStr);
        this.svg = svg;
      });
    }
  }
});

// renders an svg page from a .msgenny file
Vue.component('page-msgenny', {
  mixins: [pageStateMixin, pageSvgMixin],
  methods: {
    update: function () {
      ajaxGet(this.contentUrl, (msgennyStr) => {
        // create a tmp element to render the msgenny to, then fetch
        // the generated svg, move it to the proper page target, and
        // then remove the temporary element
        var tmpEl = document.createElement('div');
        tmpEl.id = 'msgenny-target';
        document.body.appendChild(tmpEl);
        const ast = window.msc.msgennyparser.parse(msgennyStr);
        window.msc.mscrender.renderAST(ast, null, "msgenny-target", window);
        const svg = tmpEl.innerHTML;
        document.body.removeChild(tmpEl);
        this.svg = svg;
      });
    }
  }
});

Vue.component('page-swaggerui', {
  template: '#tmpl-page-swaggerui',
  mixins: [pageStateMixin],
  data () {
    return {
      swaggerurl: '/_swagger-ui?path='+this.item.baseUrl+'/'+this.file
    }
  },
  methods: {
    update: function() {
      this.swaggerurl = '/_swagger-ui?path='+this.contentUrl;
      var el = document.querySelector('#swaggerui iframe');
      if (el) {
        el.contentWindow.location.reload(true);
      }
    }
  }
});

Vue.component('page-unsupported-type', {
  template: '#tmpl-page-unsupported-type',
  props: ['item', 'file']
});

Vue.component('page-empty', {
  template: '#tmpl-page-empty',
  props: ['item', 'file']
});

Vue.component('page-missing', {
  template: '#tmpl-page-missing',
  data () {
    return {
      path: window.location.pathname
    }
  }
});

/////
//      Misc helper functions
/////

// main page component is chosen dynamically depending on the
// currently selected filename
function choosePageComponent(item, name) {
  if (null === name) { return 'page-empty'; }

  // map of component names to boolean check
  var comps = {
    'page-markdown': () => { return ('md' == name.toLowerCase().substr(-2)); },
    'page-dot': () => { return ('dot' == name.toLowerCase().substr(-3)); },
    'page-msgenny': () => { return ('msgenny' == name.toLowerCase().substr(-7)); },
    'page-swaggerui': () => { return (name.toLowerCase() == 'api.yml' || name.toLowerCase() == 'swagger.yml'); }
  }

  // first to match wins
  for (var comp in comps) {
    if (comps[comp]()) {
      return comp;
    }
  }

  return 'page-unsupported-type';
}

function ajaxGet(url, cb) {
  var xmlhttp = new XMLHttpRequest();
  xmlhttp.onreadystatechange = function() {
    if (xmlhttp.readyState != 4) { return; }

    if (xmlhttp.status == 200 || xmlhttp.status == 304) {
      cb(xmlhttp.responseText);
      return;
    } else {
      console.log('failed to get: ', url);
    }
  };

  xmlhttp.open("GET", url, true);
  xmlhttp.send();
}

function ajaxGetJson(url, cb) {
  ajaxGet(url, function(res) {
      try {
        var data = JSON.parse(res);
      } catch(err) {
        console.log(err.message + " in " + res);
        return;
      }
      cb(data);
  });
}

function buildPathIndex(data, index) {
  index[data.uiRoute] = data;
  for (var i in data.items) {
    var parts = data.uiRoute.split('/').filter(p => p != "");
    parts.push(data.items[i]);
    var path = '/' + parts.join('/');
    index[path] = data;
  }
  for (var p in data.nested) {
    buildPathIndex(data.nested[p], index);
  }
}

/////
//        Initialize the app
/////

// load the docs index from the server, then bootstrap the app
ajaxGetJson('/_resources', function(data) {
  // assigning some state globally, sue me
  window.ws = new WebSocket('ws://localhost:8100');
  window.pathIndex = {}
  buildPathIndex(data, window.pathIndex);

  // instantiate the app component
  var AppComponent = Vue.component('app');
  window.app = new AppComponent({el: '#app', propsData: {menu: data}});
});
