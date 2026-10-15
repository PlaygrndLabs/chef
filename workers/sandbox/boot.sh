#!/bin/sh
dockerd --iptables=false --ip6tables=false --ip-forward=false > /var/log/dockerd.log 2>&1 &
exec sleep infinity
