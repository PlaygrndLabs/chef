# backoffice

The admin panel for the whole chef system, deployed as its own Worker, `chef-backoffice`, on the same Cloudflare account as the site. Only PlaygrndLabs admins can open it: people whose Cloudflare login can see the PlaygrndLabs account (the site's `CF_ACCOUNT_ID`) when they sign in to chef.

What it covers:

- **Overview**: people, organizations, how many run chef, engines behind the latest version, setups running or failed, and recent sign-ins.
- **Organizations**: every organization with its owner, members, engine and setup. One organization shows its engine (Worker, address, Cloudflare account, version, whether it answers), this month's spend against its budget, its people with their role and spend, open invitations and projects with their spend and budget.
- **People**: everyone who signed in, with their organizations and any setup or removal in progress.
- **Changes**: rename an organization, change a person's role, remove a person, cancel an invitation and set an organization's monthly budget. The site's rules still hold: Personal workspaces keep their name and their one owner, and an organization keeps its last owner.

How it works:

1. Settings in chef shows admins a Backoffice button that opens `/backoffice` on the site. The site checks the person is signed in and an admin, stores a one-time ticket on their `Member` object (valid for a minute) and sends them to `/auth/callback?ticket=…` here.
2. The backoffice redeems the ticket through the site's `Backoffice` entrypoint and sets its own signed session cookie (12 hours, `SESSION_SECRET`).
3. Every page and API call needs that cookie. The API passes the admin's id to the entrypoint, which checks again on every call that they are still an admin. The entrypoint is reachable only through the `SITE` service binding, so the site has no admin endpoints on the internet. The backoffice keeps no data of its own and never sees an engine's key.

The `backoffice` workflow deploys it after each successful `site` deploy, gives it a session key on the first run and checks that a signed-out visitor is sent to sign in.
