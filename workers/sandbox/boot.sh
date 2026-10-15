#!/bin/sh
hostname sandbox 2>/dev/null && { grep -q " sandbox$" /etc/hosts || echo "127.0.0.1 sandbox" >> /etc/hosts; }
dockerd --iptables=false --ip6tables=false --ip-forward=false > /var/log/dockerd.log 2>&1 &
exec sleep infinity
