#!/bin/bash
adb shell run-as com.openmausbot.test sh -c '
export OMB_ANDROID_LINUX_DIR=/data/user/0/com.openmausbot.test/files/linux
export OMB_ANDROID_ROOTFS=/data/user/0/com.openmausbot.test/files/linux/rootfs
export OMB_ANDROID_WORKSPACE=/data/user/0/com.openmausbot.test/files/workspace
export LD_LIBRARY_PATH=/data/user/0/com.openmausbot.test/files/linux
export PROOT_LOADER=/data/user/0/com.openmausbot.test/files/linux/loader
export PROOT_NO_SECCOMP=1
export PROOT_ASSUME_MEMFD_UNSUPPORTED=1
export PROOT_TMP_DIR=/data/user/0/com.openmausbot.test/files/linux/tmp
export HOME=/home/cua
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export TMPDIR=/data/user/0/com.openmausbot.test/files/linux/tmp
export DISPLAY=:2

/data/user/0/com.openmausbot.test/files/linux/proot -0 -R /data/user/0/com.openmausbot.test/files/linux/rootfs -b /data/user/0/com.openmausbot.test/files/linux/tmp:/tmp -b /dev:/dev -b /data/user/0/com.openmausbot.test/files/linux/rootfs/etc/passwd:/etc/passwd -b /data/user/0/com.openmausbot.test/files/workspace:/home/cua/workspace -w /tmp /bin/bash -lc "env CUA_DRIVER_INSTALL_CHANNEL=python_package CUA_DRIVER_RS_TELEMETRY_ENABLED=0 CUA_DRIVER_WINDOW_CHANGE_TIMEOUT_MS=200 NO_COLOR=1 DISPLAY=:2 /usr/local/libexec/openmausbot/cua-driver call get_desktop_state {} --socket /run/user/1000/openmausbot-cua.soc --screenshot-out-file /tmp/openmausbot-readiness.png"

# Check if screenshot was created
ls -la /data/user/0/com.openmausbot.test/files/linux/tmp/openmausbot-readiness.png
'