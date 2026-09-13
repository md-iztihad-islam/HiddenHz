"""Password -> deterministic random numbers -> permutations and starting phases."""
import functools
import hashlib

import numpy as np

SALT = b"HiddenHz-v1"
ITERATIONS = 200_000        # PBKDF2 work factor: about 0.1 s per password guess


@functools.lru_cache(maxsize=8)
def _stretch(password: str) -> bytes:
    """
    PBKDF2 makes each dictionary guess cost about 0.1 s. Cached because one decode
    tries several layouts with the same password.
    """
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), SALT, ITERATIONS, 32)


def key_rng(password: str, rows: int, cols: int) -> np.random.Generator:
    """
    (password, picture shape) -> generator. The shape is mixed into the seed so a wrong
    guess of cols gives an unrelated stream, not the encoder's first N permutations.
    See B.13.
    """
    base = _stretch(password)
    seed = hashlib.sha256(base + b"|%d|%d" % (rows, cols)).digest()
    return np.random.default_rng(np.frombuffer(seed, dtype=np.uint32))


def key_schedule(password: str, rows: int, cols: int):
    """
    Draw everything the pipeline needs, in a FIXED ORDER so that the encoder and the
    decoder get the same values.

      row_perms : one permutation of the frequency rows, per grid column
      col_perm  : one permutation of the time columns
      phi0      : starting phase of each tone
    """
    rng = key_rng(password, rows, cols)
    row_perms = [rng.permutation(rows) for _ in range(cols)]
    col_perm = rng.permutation(cols)
    phi0 = rng.uniform(0.0, 2.0 * np.pi, size=(rows, 1))
    return row_perms, col_perm, phi0


def scramble(grid, row_perms, col_perm):
    cols = grid.shape[1]
    out = np.stack([grid[row_perms[c], c] for c in range(cols)], axis=1)
    return out[:, col_perm]


def unscramble(grid, row_perms, col_perm):
    cols = grid.shape[1]
    timed = np.empty_like(grid)
    timed[:, col_perm] = grid          # undo the time shuffle
    out = np.empty_like(grid)
    for c in range(cols):
        out[row_perms[c], c] = timed[:, c]    # undo each column's frequency shuffle
    return out
