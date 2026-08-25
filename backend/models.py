"""SQLAlchemy models. `Base.metadata` is what alembic autogenerates against."""

from sqlalchemy import String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Item(Base):
    __tablename__ = "items"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    value: Mapped[int]

    def as_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "value": self.value}
