// Viewer-request on the default (site) behaviour. Paths with no file extension are app routes
// (/t/abc, /l/abc), so serve the SPA shell. Real files and other behaviours (/api/*, /m/*) pass
// through untouched, so their 404s stay 404s.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- called by the CloudFront runtime
function handler(event) {
  var request = event.request;
  var last = request.uri.split("/").pop();
  if (last.indexOf(".") === -1) {
    request.uri = "/index.html";
  }
  return request;
}
