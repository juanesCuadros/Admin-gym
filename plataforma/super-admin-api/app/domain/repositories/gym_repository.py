from abc import ABC, abstractmethod
from typing import Optional, List, Tuple
from app.infrastructure.models.superadmin_models import Gimnasio

class GymRepositoryInterface(ABC):
    @abstractmethod
    def get_by_id(self, gym_id: str) -> Optional[Gimnasio]:
        pass

    @abstractmethod
    def get_by_subdomain(self, subdomain: str) -> Optional[Gimnasio]:
        pass

    @abstractmethod
    def list_gyms(
        self,
        search: Optional[str] = None,
        estado: Optional[str] = None,
        order_by: str = "created_at",
        order_dir: str = "desc",
        limit: int = 50,
        offset: int = 0
    ) -> Tuple[List[Gimnasio], int]:
        pass

    @abstractmethod
    def save(self, gym: Gimnasio) -> Gimnasio:
        pass
