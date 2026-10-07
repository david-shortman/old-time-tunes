"""Hello unit test module."""

from ott_bp_api.hello import hello


def test_hello():
    """Test the hello function."""
    assert hello() == "Hello ott-bp-api"
