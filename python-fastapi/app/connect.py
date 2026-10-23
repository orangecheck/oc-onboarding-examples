"""OC Connect (ochk.io/docs/connect): an orangecheck account behind the site's own
login, from the backend only. Live, these are the SDK's calls with the Connect API
key; offline, the stand-ins answer with the same result types."""

import orangecheck
from orangecheck import ConnectAccount, ConnectClaimLink, ConnectDeleted, ConnectRefusal

from . import stand_in
from .config import cfg


def connect_configured() -> bool:
    c = cfg()
    return c.mode == "offline" or bool(c.connect_key)


def provision(user_id: str, consent: bool) -> ConnectAccount | ConnectRefusal:
    """`consent` only when the person ticked the box just now; unticked means no call at all."""
    c = cfg()
    if c.mode == "offline":
        return stand_in.provision(user_id, consent)
    if consent:
        return orangecheck.connect_provision(c.connect_key, user_id, consent=True)
    return orangecheck.connect_provision(c.connect_key, user_id)


def claim_link(user_id: str) -> ConnectClaimLink | ConnectRefusal:
    c = cfg()
    if c.mode == "offline":
        return stand_in.claim_link(user_id)
    return orangecheck.connect_claim_link(c.connect_key, user_id)


def delete(user_id: str) -> ConnectDeleted | ConnectRefusal:
    c = cfg()
    if c.mode == "offline":
        return stand_in.delete(user_id)
    return orangecheck.connect_delete(c.connect_key, user_id)
