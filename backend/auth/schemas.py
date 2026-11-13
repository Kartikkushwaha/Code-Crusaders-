"""Request bodies for the auth endpoints. Validation errors come back as 422 with a clear message."""
import re

from pydantic import BaseModel, Field, field_validator

EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$")
DOMAIN_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$")


def clean_email(value: str) -> str:
    value = (value or "").strip()
    if len(value) > 255 or not EMAIL_RE.match(value):
        raise ValueError("Enter a valid e-mail address.")
    return value.lower()


def check_password(v: str) -> str:
    if len(v) < 8 or not re.search(r"[A-Za-z]", v) or not re.search(r"\d", v):
        raise ValueError("Each password needs at least 8 characters, with a letter and a number.")
    return v


class RoleAccount(BaseModel):
    """One role's login, chosen by the person who registers the company."""

    login_id: str
    password: str = Field(..., min_length=8, max_length=128)
    full_name: str = Field("", max_length=150)

    @field_validator("login_id")
    @classmethod
    def _id(cls, v):
        try:
            return clean_email(v)
        except ValueError:
            raise ValueError("Each login ID must look like name@yourcompany.com.")

    @field_validator("password")
    @classmethod
    def _password(cls, v):
        return check_password(v)

    @field_validator("full_name")
    @classmethod
    def _name(cls, v):
        return " ".join((v or "").split())


class RoleAccounts(BaseModel):
    creator: RoleAccount
    manager: RoleAccount
    legal_approver: RoleAccount


class CompanyRegister(BaseModel):
    """Company + the logins of its three roles, created together."""

    company_name: str = Field(..., min_length=2, max_length=200)
    company_domain: str
    company_email: str = ""
    accounts: RoleAccounts

    @field_validator("company_name")
    @classmethod
    def _name(cls, v):
        v = " ".join((v or "").split())
        if len(v) < 2:
            raise ValueError("Enter the company name.")
        return v

    @field_validator("company_domain")
    @classmethod
    def _domain(cls, v):
        v = (v or "").strip().lower().lstrip("@")
        if len(v) > 255 or not DOMAIN_RE.match(v):
            raise ValueError("Enter a valid domain such as abc.com.")
        return v

    @field_validator("company_email")
    @classmethod
    def _email(cls, v):
        return clean_email(v) if (v or "").strip() else ""


class Login(BaseModel):
    email: str = Field(..., max_length=255)
    password: str = Field(..., min_length=1, max_length=128)
    role: str

    @field_validator("email")
    @classmethod
    def _email(cls, v):
        return (v or "").strip().lower()

    @field_validator("role")
    @classmethod
    def _role(cls, v):
        v = (v or "").strip().lower()
        if v == "legal":
            v = "legal_approver"
        if v not in ("creator", "manager", "legal_approver"):
            raise ValueError("Role must be creator, manager or legal_approver.")
        return v
