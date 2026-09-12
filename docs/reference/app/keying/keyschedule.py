"""Password -> deterministic random numbers -> permutations and starting phases."""
import functools
import hashlib

import numpy as np

SALT = b"HiddenHz-v1"
ITERATIONS = 200_000        # PBKDF2 work factor: about 0.1 s per password guess


@functools.lru_cache(maxsize=8)
def _stretch(password: str) -> bytes:
    """
    The slow half. PBKDF2 is a deliberately expensive hash, so an attacker testing a
    dictionary pays 0.1 s per guess. Cached, because one decode may try several
    layouts with the same password and there is no point paying twice.
    """
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), SALT, ITERATIONS, 32)


def key_rng(password: str, rows: int, cols: int) -> np.random.Generator:
    """
    Turn (password, picture shape) into a random number generator.

    The shape is mixed into the seed on purpose. Without it, guessing the wrong number
    of columns would still reproduce the first N row permutations correctly, because a
    generator hands out the same numbers in the same order. Mixing the shape in means
    any wrong guess about the layout gives a completely unrelated stream, so a wrong
    guess produces noise and can be detected.
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
