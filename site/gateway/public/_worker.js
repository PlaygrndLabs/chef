export default {
  fetch(request, env) {
    return env.SITE.fetch(request);
  },
};
