// Viewer-request function for www.launchboxpk.com (static site in /site).
// 301s for pages removed in the Nov 2026 redesign, then clean-URL rewrite to <path>/index.html.
var REDIRECTS = {
  '/jobs': '/careers',
  '/cv-optimizer': '/',
  '/rss.xml': '/blog',
};

function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var host = request.headers.host ? request.headers.host.value : '';

  // one canonical host: launchboxpk.com -> www.launchboxpk.com
  if (host === 'launchboxpk.com') {
    return redirect('https://www.launchboxpk.com' + uri);
  }

  if (uri.length > 1 && uri.endsWith('/')) {
    return redirect(uri.slice(0, -1));
  }

  if (REDIRECTS[uri]) return redirect(REDIRECTS[uri]);
  // old blog pagination (/blog/2) and category pages (/category/remote-work)
  if (/^\/blog\/\d+$/.test(uri) || /^\/category(\/|$)/.test(uri)) return redirect('/blog');
  if (/^\/cv-optimizer\//.test(uri)) return redirect('/');

  // Job portal is a single-page app: every /job-portal/... page loads its index.html
  if (/^\/job-portal(\/|$)/.test(uri) && !/\.[a-z0-9]+$/i.test(uri)) {
    request.uri = '/job-portal/index.html';
    return request;
  }

  if (uri === '/') {
    request.uri = '/index.html';
    return request;
  }

  if (/\.[a-z0-9]+$/i.test(uri)) {
    return request;
  }

  request.uri = uri + '/index.html';
  return request;
}

function redirect(location) {
  return {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: { location: { value: location } },
  };
}
