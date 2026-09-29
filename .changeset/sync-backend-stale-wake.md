---
"just-bash": patch
---

Fix intermittent `python3` failures with `OSError: [Errno 29] I/O error` on a busy host. A wakeup left over from the previous bridge call could end the wait for the next call before the main thread answered it. The worker now keeps waiting until the call is answered, within the same operation timeout.
