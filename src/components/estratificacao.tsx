import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ClipboardList,
  Download,
  ImageDown,
  Minus,
  Plus,
} from "lucide-react";
import {
  MACHINES,
  PROBLEMS,
  SIDE_LABEL,
  SIDE_SHORT,
  SIDES,
  STATIONS,
  activeMatrix,
  describeMatrix,
  emptyConfig,
  fichaLines,
  fichaTotal,
  formatDateBR,
  GRID_MACHINES,
  gridTargets,
  inShift,
  loadState,
  machineHasFicha,
  machineHasMatrices,
  pad2,
  problemName,
  saveState,
  shiftEntries,
  stationKey,
  todayISO,
  TURNO_LABEL,
  type Entry,
  type FichaLine,
  type GridMachine,
  type MachineId,
  type Side,
  type State,
  type StationConfig,
  type Turno,
} from "@/lib/perdas";
import { downloadBlob, renderFichaPng, renderFichasPdf } from "@/lib/ficha-image";

export function EstratificacaoApp() {
  return null;
}
