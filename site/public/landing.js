const messages = {
  unavailable: "Sign-in with Cloudflare opens soon. Until then you can set chef up yourself from the self-hosting guide.",
  cancelled: "Sign-in was cancelled. Try again whenever you are ready.",
  failed: "Cloudflare did not complete the sign-in. Please try again.",
};
const notice = document.getElementById("notice");
const reason = new URLSearchParams(location.search).get("signin");
if (notice && reason && messages[reason]) {
  notice.textContent = messages[reason];
  notice.hidden = false;
}
